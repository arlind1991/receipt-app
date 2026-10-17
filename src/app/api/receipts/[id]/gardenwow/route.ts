import { NextRequest, NextResponse } from "next/server";
import {
  authorizeGardenWowRequest,
  deleteGardenWowReceipt,
  fetchGardenWowLink,
  gardenWowErrorResponse,
  prepareGardenWowPhoto,
  sendGardenWowReceipt,
  toPence,
} from "@/lib/gardenwow/server";
import type { GardenWowReceiptLink, GardenWowSendInput } from "@/lib/gardenwow/types";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

type ReceiptForGardenWow = {
  id: string;
  image_path: string;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  currency: string | null;
  notes: string | null;
};

// Where (if anywhere) this receipt has been sent in GardenWow.
export async function GET(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const { data, error } = await fetchGardenWowLink(auth.supabase, id, auth.userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ link: (data as GardenWowReceiptLink | null) ?? null });
}

// Sends the receipt to a GardenWow client (and optionally one of their visits).
export async function POST(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const input = (await request.json().catch(() => null)) as Partial<GardenWowSendInput> | null;
  const clientId = normalizeId(input?.clientId);
  const visitId = normalizeId(input?.visitId);
  if (!clientId) {
    return NextResponse.json({ error: "Choose a GardenWow client." }, { status: 400 });
  }

  const { id } = await context.params;
  const { supabase, userId } = auth;

  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .select("id, image_path, merchant_name, receipt_date, total_amount, vat_amount, currency, notes")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<ReceiptForGardenWow>();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  const existing = await fetchGardenWowLink(supabase, receipt.id, userId);
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if (existing.data) {
    const link = existing.data as GardenWowReceiptLink;
    return NextResponse.json(
      {
        error: `Already sent to ${link.target_client_name ?? "a GardenWow client"}. Undo that first to send it somewhere else.`,
        link,
      },
      { status: 409 },
    );
  }

  if (!receipt.receipt_date || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.receipt_date)) {
    return NextResponse.json(
      { error: "Add the receipt date and save before sending to GardenWow." },
      { status: 400 },
    );
  }
  if (receipt.total_amount == null || !Number.isFinite(Number(receipt.total_amount))) {
    return NextResponse.json(
      { error: "Add the receipt total and save before sending to GardenWow." },
      { status: 400 },
    );
  }

  const totalPence = toPence(Number(receipt.total_amount));
  const vatPence =
    receipt.vat_amount != null && Number.isFinite(Number(receipt.vat_amount))
      ? toPence(Number(receipt.vat_amount))
      : null;
  if (vatPence != null && vatPence > totalPence) {
    return NextResponse.json(
      { error: "The VAT amount is more than the total. Fix it and save before sending." },
      { status: 400 },
    );
  }

  const { data: image, error: downloadError } = await supabase.storage
    .from("receipts")
    .download(receipt.image_path);
  if (downloadError || !image) {
    return NextResponse.json(
      { error: downloadError?.message ?? "The receipt image could not be loaded." },
      { status: 500 },
    );
  }

  let photo: Awaited<ReturnType<typeof prepareGardenWowPhoto>>;
  try {
    photo = await prepareGardenWowPhoto(Buffer.from(await image.arrayBuffer()));
  } catch (error) {
    console.warn("[gardenwow:photo]", {
      reason: error instanceof Error ? error.message : String(error),
      receipt_id: receipt.id,
    });
    return NextResponse.json(
      { error: "The receipt image couldn't be converted for GardenWow." },
      { status: 500 },
    );
  }

  const currency = receipt.currency?.trim().toUpperCase();

  let sendResult: Awaited<ReturnType<typeof sendGardenWowReceipt>>;
  try {
    sendResult = await sendGardenWowReceipt({
      externalId: receipt.id,
      clientId,
      visitId,
      merchant: receipt.merchant_name?.trim().slice(0, 200) || null,
      receiptDate: receipt.receipt_date,
      totalPence,
      vatPence,
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : "GBP",
      notes: receipt.notes?.trim().slice(0, 2000) || null,
      photo,
    });
  } catch (error) {
    return gardenWowErrorResponse(error as Error);
  }

  if (!sendResult.ok) {
    return gardenWowErrorResponse(sendResult.result);
  }

  // created=false means GardenWow already had this receipt (a retry after we
  // failed to record the link). Nothing changed there; record it so the UI
  // shows it as sent and it can be undone.
  const { data: link, error: linkError } = await supabase
    .from("receipt_external_links")
    .insert({
      external_id: receipt.id,
      provider: "gardenwow",
      receipt_id: receipt.id,
      target_client_id: clientId,
      target_client_name: normalizeLabel(input?.clientName),
      target_visit_id: visitId,
      target_visit_label: visitId ? normalizeLabel(input?.visitLabel) : null,
      user_id: userId,
    })
    .select(
      "external_id, target_client_id, target_client_name, target_visit_id, target_visit_label, sent_at",
    )
    .single<GardenWowReceiptLink>();

  if (linkError) {
    console.warn("[gardenwow:link]", { reason: linkError.message, receipt_id: receipt.id });
    return NextResponse.json(
      {
        error:
          "Sent to GardenWow, but SnapReceipt couldn't record it. Send again to record it; GardenWow won't duplicate it.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ created: sendResult.created, link });
}

// Removes the receipt from GardenWow and forgets the link.
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await authorizeGardenWowRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const { supabase, userId } = auth;

  const existing = await fetchGardenWowLink(supabase, id, userId);
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if (!existing.data) {
    return NextResponse.json({ error: "This receipt hasn't been sent to GardenWow." }, { status: 404 });
  }

  const link = existing.data as GardenWowReceiptLink;
  try {
    const result = await deleteGardenWowReceipt(link.external_id);
    if (!result.ok) {
      return gardenWowErrorResponse(result.result);
    }
  } catch (error) {
    return gardenWowErrorResponse(error as Error);
  }

  const { error: deleteError } = await supabase
    .from("receipt_external_links")
    .delete()
    .eq("receipt_id", id)
    .eq("user_id", userId)
    .eq("provider", "gardenwow");

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function normalizeId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().slice(0, 300) || null;
}
