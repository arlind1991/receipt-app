import "server-only";

import convertHeic from "heic-convert";
import sharp from "sharp";
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

// Turns any GardenWow failure (or a network error) into a response for the
// browser. The integration key itself is never echoed back.
export function gardenWowErrorResponse(result: GardenWowResponse | Error) {
  if (result instanceof Error) {
    const timedOut = result.name === "TimeoutError" || result.name === "AbortError";
    console.warn("[gardenwow:network]", { reason: result.message });
    return NextResponse.json(
      {
        error: timedOut
          ? "GardenWow took too long to respond. Please try again."
          : "Could not reach GardenWow. Please try again.",
      },
      { status: 502 },
    );
  }

  console.warn("[gardenwow:error]", { body: result.body, status: result.status });

  if (result.status === 401 || result.body?.error === "not_configured") {
    return NextResponse.json(
      { error: "The GardenWow integration isn't configured correctly. Check the API key on both sides." },
      { status: 502 },
    );
  }

  if (result.status === 400) {
    const fields = result.body?.fields;
    const fieldMessages =
      fields && typeof fields === "object"
        ? Object.entries(fields as Record<string, unknown>).map(
            ([field, message]) => `${field}: ${String(message)}`,
          )
        : [];
    return NextResponse.json(
      {
        error: fieldMessages.length
          ? `GardenWow rejected the receipt (${fieldMessages.join("; ")}).`
          : `GardenWow rejected the request${
              typeof result.body?.error === "string" ? `: ${result.body.error}` : "."
            }`,
      },
      { status: 400 },
    );
  }

  if (result.status === 404) {
    return NextResponse.json({ error: "Not found in GardenWow." }, { status: 404 });
  }

  if (result.status === 422) {
    return NextResponse.json(
      { error: "GardenWow can't use that client or visit. Pick another and try again." },
      { status: 422 },
    );
  }

  return NextResponse.json(
    { error: "GardenWow had a problem. Nothing was saved there; please try again." },
    { status: 502 },
  );
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
  clientId: string;
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
  form.set("clientId", payload.clientId);
  if (payload.visitId) form.set("visitId", payload.visitId);
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

type PhotoKind = "jpeg" | "png" | "webp" | "isobmff" | "unknown";

function sniffPhotoKind(bytes: Buffer): PhotoKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // HEIC/HEIF (and AVIF) files are ISO-BMFF containers starting with an ftyp box.
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    return "isobmff";
  }
  return "unknown";
}

// GardenWow accepts JPEG, PNG or WebP up to 10 MB, checked by content. Stored
// images are labelled image/jpeg whatever they really are, so go by the bytes:
// HEIC is converted to JPEG, anything else unsupported or oversized is
// re-encoded as JPEG.
export async function prepareGardenWowPhoto(bytes: Buffer) {
  let kind = sniffPhotoKind(bytes);
  let output = bytes;

  if (kind === "isobmff") {
    try {
      const converted = await convertHeic({ buffer: bytes, format: "JPEG", quality: 0.9 });
      output = Buffer.from(converted);
      kind = "jpeg";
    } catch {
      // Not decodable as HEIC (e.g. AVIF); fall through to sharp below.
    }
  }

  if (kind === "isobmff" || kind === "unknown" || output.byteLength > MAX_PHOTO_BYTES) {
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

export async function fetchGardenWowLink(supabase: AdminClient, receiptId: string, userId: string) {
  return supabase
    .from("receipt_external_links")
    .select(
      "external_id, target_client_id, target_client_name, target_visit_id, target_visit_label, sent_at",
    )
    .eq("receipt_id", receiptId)
    .eq("user_id", userId)
    .eq("provider", "gardenwow")
    .maybeSingle();
}
