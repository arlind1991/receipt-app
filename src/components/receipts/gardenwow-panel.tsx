"use client";

import { useEffect, useState } from "react";
import {
  fetchGardenWowLink,
  isGardenWowEnabled,
  listGardenWowVisits,
  searchGardenWowClients,
  sendReceiptToGardenWow,
  undoGardenWowSend,
} from "@/lib/gardenwow/client";
import type {
  GardenWowClient,
  GardenWowReceiptLink,
  GardenWowVisit,
} from "@/lib/gardenwow/types";

type GardenWowPanelProps = {
  hasUnsavedChanges: boolean;
  receiptDate: string | null;
  receiptId: string;
  totalAmount: number | null;
  userId: string;
};

// Only rendered for accounts on the GardenWow allowlist; renders nothing otherwise.
export function GardenWowPanel({
  hasUnsavedChanges,
  receiptDate,
  receiptId,
  totalAmount,
  userId,
}: GardenWowPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [link, setLink] = useState<GardenWowReceiptLink | null>(null);
  const [linkLoaded, setLinkLoaded] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const isEnabled = await isGardenWowEnabled(userId);
      if (cancelled || !isEnabled) {
        return;
      }
      setEnabled(true);

      const result = await fetchGardenWowLink(receiptId);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLink(result.data);
      } else {
        setMessage({ text: result.error, tone: "error" });
      }
      setLinkLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [receiptId, userId]);

  if (!enabled) {
    return null;
  }

  const missingFields = [
    !receiptDate ? "date" : null,
    totalAmount == null ? "total" : null,
  ].filter(Boolean);
  const blockedReason = hasUnsavedChanges
    ? "Save your changes before sending."
    : missingFields.length
      ? `Add the ${missingFields.join(" and ")} and save before sending.`
      : null;

  async function handleUndo() {
    if (!link) {
      return;
    }
    const confirmed = window.confirm(
      `Remove this receipt from ${link.target_client_name ?? "GardenWow"}? It's deleted from GardenWow and can be sent again.`,
    );
    if (!confirmed) {
      return;
    }

    setIsUndoing(true);
    setMessage(null);
    const result = await undoGardenWowSend(receiptId);
    setIsUndoing(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error" });
      return;
    }
    setLink(null);
    setMessage({ text: "Removed from GardenWow.", tone: "info" });
  }

  return (
    <section className="glass-panel rounded-[28px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">GardenWow</p>
          {!linkLoaded ? (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Checking...</p>
          ) : link ? (
            <>
              <p className="mt-2 truncate text-sm font-semibold text-[var(--text-primary)]">
                Sent to {link.target_client_name ?? "client"}
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {link.target_visit_label ? `Visit: ${link.target_visit_label}` : "No visit"} ·{" "}
                {new Date(link.sent_at).toLocaleDateString("en-GB")}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {blockedReason ?? "Add this receipt to a client's job costs."}
            </p>
          )}
        </div>
        {linkLoaded ? (
          link ? (
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={isUndoing}
              className="secondary-button shrink-0 rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUndoing ? "Removing..." : "Undo"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setIsPickerOpen(true);
              }}
              disabled={Boolean(blockedReason)}
              className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send
            </button>
          )
        ) : null}
      </div>

      {message ? (
        <p
          className={`mt-3 text-sm ${
            message.tone === "error" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {isPickerOpen ? (
        <GardenWowPicker
          receiptDate={receiptDate}
          receiptId={receiptId}
          onClose={() => setIsPickerOpen(false)}
          onSent={(nextLink, created) => {
            setLink(nextLink);
            setIsPickerOpen(false);
            setMessage({
              text: created
                ? "Sent to GardenWow."
                : "GardenWow already had this receipt, so nothing changed there.",
              tone: "info",
            });
          }}
        />
      ) : null}
    </section>
  );
}

function GardenWowPicker({
  onClose,
  onSent,
  receiptDate,
  receiptId,
}: {
  onClose: () => void;
  onSent: (link: GardenWowReceiptLink, created: boolean) => void;
  receiptDate: string | null;
  receiptId: string;
}) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<GardenWowClient[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [selectedClient, setSelectedClient] = useState<GardenWowClient | null>(null);
  const [visits, setVisits] = useState<GardenWowVisit[]>([]);
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      const result = await searchGardenWowClients(query);
      if (cancelled) {
        return;
      }
      setIsSearching(false);
      if (result.ok) {
        setClients(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function chooseClient(client: GardenWowClient) {
    setSelectedClient(client);
    setSelectedVisitId(null);
    setVisits([]);
    setError(null);
    setIsLoadingVisits(true);
    const result = await listGardenWowVisits(client.id, receiptDate);
    setIsLoadingVisits(false);
    if (result.ok) {
      setVisits(result.data);
    } else {
      setError(result.error);
    }
  }

  async function handleSend() {
    if (!selectedClient) {
      return;
    }
    const visit = visits.find((item) => item.id === selectedVisitId) ?? null;

    setIsSending(true);
    setError(null);
    const result = await sendReceiptToGardenWow(receiptId, {
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      visitId: visit?.id ?? null,
      visitLabel: visit ? formatVisitLabel(visit) : null,
    });
    setIsSending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSent(result.data.link, result.data.created);
  }

  return (
    <section className="fixed inset-0 z-[75] bg-[rgba(5,10,18,0.46)]" onClick={onClose}>
      <div className="flex min-h-dvh items-end justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        <div
          className="glass-panel flex max-h-[80dvh] w-full max-w-md flex-col rounded-[30px] p-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            {selectedClient ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedClient(null);
                  setError(null);
                }}
                className="secondary-button rounded-full px-4 py-2 text-sm transition"
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {selectedClient ? "Pick a visit" : "Send to GardenWow"}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="secondary-button rounded-full px-4 py-2 text-sm transition"
            >
              Cancel
            </button>
          </div>

          {!selectedClient ? (
            <>
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Client name, email or postcode"
                className="field-control mt-4 w-full rounded-2xl px-4 py-3 text-sm outline-none"
              />
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                {isSearching && clients.length === 0 ? (
                  <PickerNote text="Searching..." />
                ) : clients.length === 0 ? (
                  <PickerNote text="No matching clients." />
                ) : (
                  clients.map((client) => (
                    <PickerRow
                      key={client.id}
                      onClick={() => void chooseClient(client)}
                      subtitle={[client.organisationName, client.addressLine1, client.postcode]
                        .filter(Boolean)
                        .join(" · ")}
                      title={client.name}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 truncate text-sm text-[var(--text-secondary)]">
                {selectedClient.name}
                {receiptDate ? ` · visits around ${formatShortDate(receiptDate)}` : ""}
              </p>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                <PickerRow
                  onClick={() => setSelectedVisitId(null)}
                  selected={selectedVisitId === null}
                  subtitle="Attach to the client only"
                  title="No visit"
                />
                {isLoadingVisits ? (
                  <PickerNote text="Loading visits..." />
                ) : visits.length === 0 ? (
                  <PickerNote text="No visits near the receipt date." />
                ) : (
                  visits.map((visit) => (
                    <PickerRow
                      key={visit.id}
                      onClick={() => setSelectedVisitId(visit.id)}
                      selected={selectedVisitId === visit.id}
                      subtitle={[visit.serviceLabel, visit.address, visit.status]
                        .filter(Boolean)
                        .join(" · ")}
                      title={formatVisitLabel(visit)}
                    />
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSending || isLoadingVisits}
                className="mt-4 w-full rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending ? "Sending..." : `Send to ${selectedClient.name}`}
              </button>
            </>
          )}

          {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function PickerRow({
  onClick,
  selected = false,
  subtitle,
  title,
}: {
  onClick: () => void;
  selected?: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[22px] px-4 py-3 text-left transition ${
        selected ? "bg-[var(--surface-soft)]" : "hover:bg-[var(--nav-hover)]"
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
            {title}
          </span>
          {subtitle ? (
            <span className="mt-0.5 block truncate text-xs text-[var(--text-secondary)]">
              {subtitle}
            </span>
          ) : null}
        </span>
        {selected ? <span className="text-sm text-[var(--accent)]">✓</span> : null}
      </span>
    </button>
  );
}

function PickerNote({ text }: { text: string }) {
  return <p className="px-4 py-3 text-sm text-[var(--text-muted)]">{text}</p>;
}

function formatShortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
}

function formatVisitLabel(visit: GardenWowVisit) {
  const slot = visit.slot ? ` ${visit.slot.toUpperCase()}` : "";
  return `${formatShortDate(visit.date)}${slot}`;
}
