import "server-only";

import { createHash } from "node:crypto";
import {
  deleteGardenWowReceipt,
  describeGardenWowFailure,
  fetchGardenWowLink,
  isGardenWowEnabledForUser,
  LINK_SELECT,
  prepareGardenWowPhoto,
  sendGardenWowReceipt,
  toPence,
  type AdminClient,
} from "@/lib/gardenwow/server";
import type {
  GardenWowReceiptLink,
  GardenWowReceiptState,
  GardenWowTarget,
} from "@/lib/gardenwow/types";

// Keeps GardenWow in step with a receipt for allowlisted accounts: sends it
// once it has a date and total, replaces it when its details or destination
// change, and removes it on request or when the receipt is deleted.

const RECEIPT_SELECT =
  "id, image_path, merchant_name, receipt_date, total_amount, vat_amount, currency, notes, gardenwow_client_id, gardenwow_client_name, gardenwow_visit_id, gardenwow_visit_label";

type ReceiptForSync = {
  id: string;
  image_path: string | null;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  currency: string | null;
  notes: string | null;
  gardenwow_client_id: string | null;
  gardenwow_client_name: string | null;
  gardenwow_visit_id: string | null;
  gardenwow_visit_label: string | null;
};

export type SyncOutcome =
  | { state: "disabled" }
  | { state: "not_found" }
  | { state: "waiting"; missing: Array<"date" | "total" | "photo"> }
  | { state: "removed" }
  | { state: "unchanged" }
  | { state: "sent"; created: boolean }
  | { state: "failed"; message: string; status: number };

function targetOf(receipt: ReceiptForSync): GardenWowTarget {
  const clientId = receipt.gardenwow_client_id || null;
  return {
    clientId,
    clientName: clientId ? receipt.gardenwow_client_name : null,
    visitId: clientId ? receipt.gardenwow_visit_id || null : null,
    visitLabel: clientId && receipt.gardenwow_visit_id ? receipt.gardenwow_visit_label : null,
  };
}

function missingFields(receipt: ReceiptForSync) {
  const missing: Array<"date" | "total" | "photo"> = [];
  if (!receipt.receipt_date || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.receipt_date)) missing.push("date");
  if (receipt.total_amount == null || !Number.isFinite(Number(receipt.total_amount))) missing.push("total");
  if (!receipt.image_path) missing.push("photo");
  return missing;
}

export class GardenWowSetupError extends Error {}

async function loadReceipt(supabase: AdminClient, receiptId: string, userId: string) {
  const { data, error } = await supabase
    .from("receipts")
    .select(RECEIPT_SELECT)
    .eq("id", receiptId)
    .eq("user_id", userId)
    .maybeSingle<ReceiptForSync>();
  // 42703 = undefined column: migration 006 hasn't been applied yet.
  if (error?.code === "42703") {
    throw new GardenWowSetupError(
      "GardenWow isn't fully set up yet: the database update (migration 006) still needs to be run.",
    );
  }
  return data;
}

export async function getGardenWowState(
  supabase: AdminClient,
  receiptId: string,
  userId: string,
): Promise<GardenWowReceiptState | null> {
  const receipt = await loadReceipt(supabase, receiptId, userId);
  if (!receipt) {
    return null;
  }
  const { data: link } = await fetchGardenWowLink(supabase, receiptId, userId);
  return {
    link: (link as GardenWowReceiptLink | null) ?? null,
    target: targetOf(receipt),
    missing: missingFields(receipt),
  };
}

export async function setGardenWowTarget(
  supabase: AdminClient,
  receiptId: string,
  userId: string,
  target: GardenWowTarget,
) {
  const clientId = target.clientId || null;
  return supabase
    .from("receipts")
    .update({
      gardenwow_client_id: clientId,
      gardenwow_client_name: clientId ? target.clientName : null,
      gardenwow_visit_id: clientId ? target.visitId || null : null,
      gardenwow_visit_label: clientId && target.visitId ? target.visitLabel : null,
    })
    .eq("id", receiptId)
    .eq("user_id", userId);
}

// restore: send even if the user removed it from GardenWow earlier.
export async function syncReceiptToGardenWow(
  supabase: AdminClient,
  receiptId: string,
  userId: string,
  options: { restore?: boolean } = {},
): Promise<SyncOutcome> {
  if (!isGardenWowEnabledForUser(userId)) {
    return { state: "disabled" };
  }

  let receipt: ReceiptForSync | null;
  try {
    receipt = await loadReceipt(supabase, receiptId, userId);
  } catch (error) {
    // Never let an unfinished GardenWow setup break reading or saving a receipt.
    if (error instanceof GardenWowSetupError) {
      return { state: "failed", message: error.message, status: 503 };
    }
    throw error;
  }
  if (!receipt) {
    return { state: "not_found" };
  }
  const { data: linkData } = await fetchGardenWowLink(supabase, receiptId, userId);
  const link = (linkData as GardenWowReceiptLink | null) ?? null;

  if (link?.status === "removed" && !options.restore) {
    return { state: "removed" };
  }

  const missing = missingFields(receipt);
  if (missing.length) {
    return { state: "waiting", missing };
  }

  const target = targetOf(receipt);
  const totalPence = toPence(Number(receipt.total_amount));
  const vatPence =
    receipt.vat_amount != null && Number.isFinite(Number(receipt.vat_amount))
      ? toPence(Number(receipt.vat_amount))
      : null;
  const currency = receipt.currency?.trim().toUpperCase();
  const fields = {
    merchant: receipt.merchant_name?.trim().slice(0, 200) || null,
    receiptDate: receipt.receipt_date!,
    totalPence,
    vatPence,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : "GBP",
    notes: receipt.notes?.trim().slice(0, 2000) || null,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify({ fields, image: receipt.image_path, target }))
    .digest("hex");

  if (link?.status === "sent" && link.sent_hash === hash) {
    return { state: "unchanged" };
  }

  if (vatPence != null && vatPence > totalPence) {
    return recordFailure(supabase, receipt.id, userId, target, {
      message: "The VAT is more than the total. Fix it and save to send to GardenWow.",
      status: 400,
    });
  }

  // GardenWow ignores a resend with the same externalId, so a changed receipt
  // is replaced: delete the old copy, then send the new one.
  if (link?.status === "sent" || link?.status === "failed") {
    try {
      const removed = await deleteGardenWowReceipt(receipt.id);
      if (!removed.ok) {
        return recordFailure(supabase, receipt.id, userId, target, describeGardenWowFailure(removed.result));
      }
    } catch (error) {
      return recordFailure(supabase, receipt.id, userId, target, describeGardenWowFailure(error as Error));
    }
  }

  const { data: image, error: downloadError } = await supabase.storage
    .from("receipts")
    .download(receipt.image_path!);
  if (downloadError || !image) {
    return recordFailure(supabase, receipt.id, userId, target, {
      message: "The receipt image could not be loaded.",
      status: 500,
    });
  }

  let photo: Awaited<ReturnType<typeof prepareGardenWowPhoto>>;
  try {
    photo = await prepareGardenWowPhoto(Buffer.from(await image.arrayBuffer()));
  } catch {
    return recordFailure(supabase, receipt.id, userId, target, {
      message: "The receipt image couldn't be converted for GardenWow.",
      status: 500,
    });
  }

  try {
    const sent = await sendGardenWowReceipt({
      externalId: receipt.id,
      clientId: target.clientId,
      visitId: target.visitId,
      ...fields,
      photo,
    });
    if (!sent.ok) {
      return recordFailure(supabase, receipt.id, userId, target, describeGardenWowFailure(sent.result));
    }

    await saveLink(supabase, receipt.id, userId, target, {
      last_error: null,
      sent_at: new Date().toISOString(),
      sent_hash: hash,
      status: "sent",
    });
    return { state: "sent", created: sent.created };
  } catch (error) {
    return recordFailure(supabase, receipt.id, userId, target, describeGardenWowFailure(error as Error));
  }
}

// Removes the receipt from GardenWow. forget: also drop our record (used when
// the receipt itself is being deleted); otherwise it's marked removed so it
// isn't sent again automatically.
export async function removeReceiptFromGardenWow(
  supabase: AdminClient,
  receiptId: string,
  userId: string,
  options: { forget?: boolean } = {},
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const { data: linkData } = await fetchGardenWowLink(supabase, receiptId, userId);
  const link = (linkData as GardenWowReceiptLink | null) ?? null;

  if (link && link.status !== "removed") {
    // After a failed send GardenWow most likely has nothing, so a failure to
    // reach it shouldn't block removal; for a sent receipt it must.
    const mustSucceed = link.status === "sent";
    try {
      const removed = await deleteGardenWowReceipt(link.external_id);
      if (!removed.ok && mustSucceed) {
        return { ok: false, ...describeGardenWowFailure(removed.result) };
      }
    } catch (error) {
      if (mustSucceed) {
        return { ok: false, ...describeGardenWowFailure(error as Error) };
      }
    }
  }

  if (options.forget) {
    await supabase
      .from("receipt_external_links")
      .delete()
      .eq("receipt_id", receiptId)
      .eq("user_id", userId)
      .eq("provider", "gardenwow");
    return { ok: true };
  }

  const receipt = await loadReceipt(supabase, receiptId, userId).catch(() => null);
  await saveLink(supabase, receiptId, userId, receipt ? targetOf(receipt) : emptyTarget(), {
    last_error: null,
    sent_hash: null,
    status: "removed",
  });
  return { ok: true };
}

async function recordFailure(
  supabase: AdminClient,
  receiptId: string,
  userId: string,
  target: GardenWowTarget,
  failure: { message: string; status: number },
): Promise<SyncOutcome> {
  await saveLink(supabase, receiptId, userId, target, {
    last_error: failure.message,
    sent_hash: null,
    status: "failed",
  });
  return { state: "failed", ...failure };
}

async function saveLink(
  supabase: AdminClient,
  receiptId: string,
  userId: string,
  target: GardenWowTarget,
  values: { status: GardenWowReceiptLink["status"]; last_error: string | null; sent_hash: string | null; sent_at?: string },
) {
  const { error } = await supabase
    .from("receipt_external_links")
    .upsert(
      {
        external_id: receiptId,
        provider: "gardenwow",
        receipt_id: receiptId,
        target_client_id: target.clientId,
        target_client_name: target.clientName,
        target_visit_id: target.visitId,
        target_visit_label: target.visitLabel,
        updated_at: new Date().toISOString(),
        user_id: userId,
        ...values,
      },
      { onConflict: "receipt_id,provider" },
    )
    .select(LINK_SELECT);
  if (error) {
    console.warn("[gardenwow:link]", { reason: error.message, receipt_id: receiptId });
  }
}

function emptyTarget(): GardenWowTarget {
  return { clientId: null, clientName: null, visitId: null, visitLabel: null };
}
