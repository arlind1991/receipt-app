import { getAccessToken } from "@/lib/receipt-service";
import type {
  GardenWowClient,
  GardenWowReceiptLink,
  GardenWowSendInput,
  GardenWowVisit,
} from "@/lib/gardenwow/types";
import type { Result } from "@/lib/types";

// Browser-side calls to SnapReceipt's own GardenWow routes. The GardenWow API
// key never reaches the browser; these only carry the user's session token.

const enabledByUser = new Map<string, Promise<boolean>>();

async function request<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
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
    const json = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

    if (!response.ok || !json) {
      return { ok: false, error: json?.error ?? "Something went wrong talking to GardenWow." };
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

export async function searchGardenWowClients(query: string) {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  const result = await request<{ clients: GardenWowClient[] }>(
    `/api/integrations/gardenwow/clients${params.size ? `?${params}` : ""}`,
  );
  return result.ok ? { ok: true as const, data: result.data.clients } : result;
}

export async function listGardenWowVisits(clientId: string, around: string | null) {
  const params = new URLSearchParams();
  if (around) {
    params.set("around", around);
  }
  const result = await request<{ visits: GardenWowVisit[] }>(
    `/api/integrations/gardenwow/clients/${encodeURIComponent(clientId)}/visits${
      params.size ? `?${params}` : ""
    }`,
  );
  return result.ok ? { ok: true as const, data: result.data.visits } : result;
}

export async function fetchGardenWowLink(receiptId: string) {
  const result = await request<{ link: GardenWowReceiptLink | null }>(
    `/api/receipts/${receiptId}/gardenwow`,
  );
  return result.ok ? { ok: true as const, data: result.data.link } : result;
}

export async function sendReceiptToGardenWow(receiptId: string, input: GardenWowSendInput) {
  const result = await request<{ created: boolean; link: GardenWowReceiptLink }>(
    `/api/receipts/${receiptId}/gardenwow`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.ok ? { ok: true as const, data: result.data } : result;
}

export async function undoGardenWowSend(receiptId: string) {
  const result = await request<{ ok: true }>(`/api/receipts/${receiptId}/gardenwow`, {
    method: "DELETE",
  });
  return result.ok ? { ok: true as const, data: undefined } : result;
}
