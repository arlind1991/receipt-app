import "server-only";

import sharp from "sharp";
import { convertHeicToJpeg, sniffImageKind } from "@/lib/image-format";
import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUserFromAccessToken,
  getSupabaseAdminClient,
  supabaseServerEnvError,
} from "@/lib/supabase/server";
import type { GardenWowClient, GardenWowVisit } from "@/lib/gardenwow/types";

// Server-to-server integration with the GardenWow platform
// (see docs/GARDENWOW_API.md). Only allowlisted SnapReceipt accounts may use
// it; everyone else gets a 404 so the feature is invisible to them.

const apiKey = process.env.SNAPRECEIPT_API_KEY?.trim() || null;
const baseUrl = (process.env.GARDENWOW_BASE_URL?.trim() || "https://app.gardenwow.uk").replace(
  /\/+$/,
  "",
);
const apiRoot = `${baseUrl}/api/integrations/snapreceipt`;
const allowedUserIds = new Set(
  (process.env.GARDENWOW_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PHOTO_BYTES = 10_000_000;
const MAX_PHOTO_DIMENSION = 3000;

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

export function isGardenWowEnabledForUser(userId: string) {
  return Boolean(apiKey) && allowedUserIds.has(userId);
}

// Resolves the signed-in user from the Bearer session token and checks the
// allowlist. Returns a ready-made error response when the request can't proceed.
export async function authorizeGardenWowRequest(request: NextRequest): Promise<
  | { ok: true; userId: string; supabase: AdminClient }
  | { ok: false; response: NextResponse }
> {
  if (supabaseServerEnvError) {
    return {
      ok: false,
      response: NextResponse.json({ error: supabaseServerEnvError }, { status: 500 }),
    };
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing session token." }, { status: 401 }),
    };
  }

  const authResult = await getAuthenticatedUserFromAccessToken(accessToken);
  if (!authResult.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: authResult.error }, { status: 401 }),
    };
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ error: supabaseServerEnvError }, { status: 500 }),
    };
  }

  if (!isGardenWowEnabledForUser(authResult.data.id)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found." }, { status: 404 }),
    };
  }

  return { ok: true, userId: authResult.data.id, supabase };
}

type GardenWowResponse = {
  status: number;
  body: Record<string, unknown> | null;
};

async function callGardenWow(path: string, init: RequestInit = {}): Promise<GardenWowResponse> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
}

// Turns any GardenWow failure (or a network error) into a message for the
// user and a status for our own response. The integration key is never echoed.
export function describeGardenWowFailure(result: GardenWowResponse | Error): {
  message: string;
  status: number;
} {
  if (result instanceof Error) {
    const timedOut = result.name === "TimeoutError" || result.name === "AbortError";
    console.warn("[gardenwow:network]", { reason: result.message });
    return {
      message: timedOut
        ? "GardenWow took too long to respond. Please try again."
        : "Could not reach GardenWow. Please try again.",
      status: 502,
    };
  }

  console.warn("[gardenwow:error]", { body: result.body, status: result.status });

  if (result.status === 401 || result.body?.error === "not_configured") {
    return {
      message:
        "The GardenWow integration isn't configured correctly. Check the API key on both sides.",
      status: 502,
    };
  }

  if (result.status === 400) {
    const fields = result.body?.fields;
    const fieldMessages =
      fields && typeof fields === "object"
        ? Object.entries(fields as Record<string, unknown>).map(
            ([field, message]) => `${field}: ${String(message)}`,
          )
        : [];
    return {
      message: fieldMessages.length
        ? `GardenWow rejected the receipt (${fieldMessages.join("; ")}).`
        : `GardenWow rejected the request${
            typeof result.body?.error === "string" ? `: ${result.body.error}` : "."
          }`,
      status: 400,
    };
  }

  if (result.status === 404) {
    return { message: "Not found in GardenWow.", status: 404 };
  }

  if (result.status === 422) {
    return {
      message: "GardenWow can't use that client or visit. Pick another and try again.",
      status: 422,
    };
  }

  return {
    message: "GardenWow had a problem. Nothing was saved there; please try again.",
    status: 502,
  };
}

export function gardenWowErrorResponse(result: GardenWowResponse | Error) {
  const { message, status } = describeGardenWowFailure(result);
  return NextResponse.json({ error: message }, { status });
}

export async function searchGardenWowClients(query: string) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  const suffix = params.size ? `?${params}` : "";
  const result = await callGardenWow(`/clients${suffix}`);
  if (result.status !== 200) {
    return { ok: false as const, result };
  }

  const clients = Array.isArray(result.body?.clients) ? result.body.clients : [];
  return { ok: true as const, clients: clients as GardenWowClient[] };
}

export async function listGardenWowVisits(clientId: string, around: string | null) {
  const params = new URLSearchParams();
  if (around) {
    params.set("around", around);
  }
  const suffix = params.size ? `?${params}` : "";
  const result = await callGardenWow(`/clients/${encodeURIComponent(clientId)}/visits${suffix}`);
  if (result.status !== 200) {
    return { ok: false as const, result };
  }

  const visits = Array.isArray(result.body?.visits) ? result.body.visits : [];
  return { ok: true as const, visits: visits as GardenWowVisit[] };
}

export type GardenWowReceiptPayload = {
  externalId: string;
  // null = the Unassigned folder.
  clientId: string | null;
  visitId: string | null;
  merchant: string | null;
  receiptDate: string;
  totalPence: number;
  vatPence: number | null;
  currency: string;
  notes: string | null;
  photo: { bytes: Buffer; contentType: string; filename: string };
};

export async function sendGardenWowReceipt(payload: GardenWowReceiptPayload) {
  const form = new FormData();
  form.set(
    "photo",
    new Blob([new Uint8Array(payload.photo.bytes)], { type: payload.photo.contentType }),
    payload.photo.filename,
  );
  form.set("externalId", payload.externalId);
  if (payload.clientId) form.set("clientId", payload.clientId);
  if (payload.clientId && payload.visitId) form.set("visitId", payload.visitId);
  if (payload.merchant) form.set("merchant", payload.merchant);
  form.set("receiptDate", payload.receiptDate);
  form.set("totalPence", String(payload.totalPence));
  if (payload.vatPence != null) form.set("vatPence", String(payload.vatPence));
  form.set("currency", payload.currency);
  if (payload.notes) form.set("notes", payload.notes);

  const result = await callGardenWow("/receipts", { method: "POST", body: form });
  if (result.status !== 200 && result.status !== 201) {
    return { ok: false as const, result };
  }

  return { ok: true as const, created: result.body?.created === true };
}

export async function deleteGardenWowReceipt(externalId: string) {
  const result = await callGardenWow(`/receipts/${encodeURIComponent(externalId)}`, {
    method: "DELETE",
  });
  // 404 means GardenWow no longer has it, which is the outcome we want anyway.
  if (result.status !== 200 && result.status !== 404) {
    return { ok: false as const, result };
  }

  return { ok: true as const };
}

// £12.34 → 1234. Amounts are stored to 2dp, so rounding only removes float noise.
export function toPence(value: number) {
  return Math.round(value * 100);
}

// GardenWow accepts JPEG, PNG or WebP up to 10 MB, checked by content: HEIC is
// converted to JPEG, anything else unsupported or oversized is re-encoded as JPEG.
export async function prepareGardenWowPhoto(bytes: Buffer) {
  const heic = await convertHeicToJpeg(bytes);
  let output = heic.bytes;
  let kind = sniffImageKind(output);

  if (
    (kind !== "jpeg" && kind !== "png" && kind !== "webp") ||
    output.byteLength > MAX_PHOTO_BYTES
  ) {
    output = await sharp(output, { failOn: "none" })
      .rotate()
      .resize({
        fit: "inside",
        height: MAX_PHOTO_DIMENSION,
        width: MAX_PHOTO_DIMENSION,
        withoutEnlargement: true,
      })
      .jpeg({ mozjpeg: true, quality: 85 })
      .toBuffer();
    kind = "jpeg";
  }

  const extension = kind === "jpeg" ? "jpg" : kind;
  return {
    bytes: output,
    contentType: `image/${kind}`,
    filename: `receipt.${extension}`,
  };
}

export const LINK_SELECT =
  "external_id, target_client_id, target_client_name, target_visit_id, target_visit_label, sent_at, status, last_error, sent_hash";

export async function fetchGardenWowLink(supabase: AdminClient, receiptId: string, userId: string) {
  return supabase
    .from("receipt_external_links")
    .select(LINK_SELECT)
    .eq("receipt_id", receiptId)
    .eq("user_id", userId)
    .eq("provider", "gardenwow")
    .maybeSingle();
}

export type { AdminClient };
