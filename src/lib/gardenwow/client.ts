import { getAccessToken } from "@/lib/receipt-service";
import type {
  GardenWowClient,
  GardenWowReceiptState,
  GardenWowTarget,
  GardenWowVisit,
} from "@/lib/gardenwow/types";
import type { Result } from "@/lib/types";

// Browser-side calls to SnapReceipt's own GardenWow routes. The GardenWow API
// key never reaches the browser; these only carry the user's session token.

const enabledByUser = new Map<string, Promise<boolean>>();

type Failure = { ok: false; error: string; state?: GardenWowReceiptState };

async function request<T>(path: string, init: RequestInit = {}): Promise<{ ok: true; data: T } | Failure> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "You need to sign in first." };
  }

  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...init.headers,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const json = (await response.json().catch(() => null)) as
      | (T & { error?: string } & Partial<GardenWowReceiptState>)
      | null;

    if (!response.ok || !json) {
      return {
        ok: false,
        error: json?.error ?? "Something went wrong talking to GardenWow.",
        // Send/retry failures still return the receipt's current state.
        state: json && "target" in json ? (json as unknown as GardenWowReceiptState) : undefined,
      };
    }

    return { ok: true, data: json };
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }
}

// Cached per user for the page's lifetime; the allowlist rarely changes.
export function isGardenWowEnabled(userId: string) {
  let enabled = enabledByUser.get(userId);
  if (!enabled) {
    enabled = request<{ enabled: boolean }>("/api/integrations/gardenwow/status").then(
      (result) => {
        if (!result.ok) {
          enabledByUser.delete(userId);
          return false;
        }
        return result.data.enabled;
      },
    );
    enabledByUser.set(userId, enabled);
  }
  return enabled;
}

export async function searchGardenWowClients(query: string): Promise<Result<GardenWowClient[]>> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  const result = await request<{ clients: GardenWowClient[] }>(
    `/api/integrations/gardenwow/clients${params.size ? `?${params}` : ""}`,
  );
  return result.ok ? { ok: true, data: result.data.clients } : result;
}

export async function listGardenWowVisits(
  clientId: string,
  around: string | null,
): Promise<Result<GardenWowVisit[]>> {
  const params = new URLSearchParams();
  if (around) {
    params.set("around", around);
  }
  const result = await request<{ visits: GardenWowVisit[] }>(
    `/api/integrations/gardenwow/clients/${encodeURIComponent(clientId)}/visits${
      params.size ? `?${params}` : ""
    }`,
  );
  return result.ok ? { ok: true, data: result.data.visits } : result;
}

export async function fetchGardenWowState(receiptId: string) {
  return request<GardenWowReceiptState>(`/api/receipts/${receiptId}/gardenwow`);
}

// Sends now. With a target, also changes where it goes; without one, retries
// with the current destination.
export async function sendReceiptToGardenWow(receiptId: string, target?: GardenWowTarget) {
  return request<GardenWowReceiptState & { outcome: string }>(`/api/receipts/${receiptId}/gardenwow`, {
    method: "POST",
    body: JSON.stringify(target ?? {}),
  });
}

export async function removeReceiptFromGardenWow(receiptId: string) {
  return request<GardenWowReceiptState>(`/api/receipts/${receiptId}/gardenwow`, {
    method: "DELETE",
  });
}

// The client chosen on the camera screen for new receipts. Kept for this app
// session only, so each time the app is opened it starts at Unassigned.
const CAPTURE_TARGET_KEY = "snapreceipt.gardenwow.captureTarget";

export function getCaptureTarget(): { clientId: string; clientName: string } | null {
  try {
    const stored = window.sessionStorage.getItem(CAPTURE_TARGET_KEY);
    const parsed = stored ? (JSON.parse(stored) as { clientId?: unknown; clientName?: unknown }) : null;
    return parsed && typeof parsed.clientId === "string" && typeof parsed.clientName === "string"
      ? { clientId: parsed.clientId, clientName: parsed.clientName }
      : null;
  } catch {
    return null;
  }
}

export function setCaptureTarget(target: { clientId: string; clientName: string } | null) {
  try {
    if (target) {
      window.sessionStorage.setItem(CAPTURE_TARGET_KEY, JSON.stringify(target));
    } else {
      window.sessionStorage.removeItem(CAPTURE_TARGET_KEY);
    }
  } catch {
    // Private mode or storage blocked: the choice just won't be remembered.
  }
}
