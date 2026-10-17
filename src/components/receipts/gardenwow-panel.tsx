"use client";

import { useEffect, useState } from "react";
import {
  fetchGardenWowState,
  isGardenWowEnabled,
  listGardenWowVisits,
  removeReceiptFromGardenWow,
  searchGardenWowClients,
  sendReceiptToGardenWow,
} from "@/lib/gardenwow/client";
import type {
  GardenWowClient,
  GardenWowReceiptState,
  GardenWowTarget,
  GardenWowVisit,
} from "@/lib/gardenwow/types";

type GardenWowPanelProps = {
  hasUnsavedChanges: boolean;
  receiptDate: string | null;
  receiptId: string;
  // Changes whenever the receipt is saved, so the panel picks up the new state.
  refreshKey: string;
  userId: string;
};

// Only rendered for accounts on the GardenWow allowlist; renders nothing otherwise.
export function GardenWowPanel({
  hasUnsavedChanges,
  receiptDate,
  receiptId,
  refreshKey,
  userId,
}: GardenWowPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<GardenWowReceiptState | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [busy, setBusy] = useState<null | "sending" | "removing">(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const isEnabled = await isGardenWowEnabled(userId);
      if (cancelled || !isEnabled) {
        return;
      }
      setEnabled(true);

      const result = await fetchGardenWowState(receiptId);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState(result.data);
      } else {
        setMessage({ text: result.error, tone: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [receiptId, userId, refreshKey]);

  if (!enabled) {
    return null;
  }

  const link = state?.link ?? null;
  const target = state?.target ?? null;
  const missing = state?.missing ?? [];

  async function send(nextTarget?: GardenWowTarget) {
    setBusy("sending");
    setMessage(null);
    const result = await sendReceiptToGardenWow(receiptId, nextTarget);
    setBusy(null);
    if (result.ok) {
      setState(result.data);
      setMessage({
        text: result.data.outcome === "unchanged" ? "GardenWow is already up to date." : "Sent to GardenWow.",
        tone: "info",
      });
      return true;
    }
    if (result.state) {
      setState(result.state);
    }
    setMessage({ text: result.error, tone: "error" });
    return false;
  }

  async function handleRemove() {
    const confirmed = window.confirm(
      "Remove this receipt from GardenWow? It won't be sent again unless you send it.",
    );
    if (!confirmed) {
      return;
    }

    setBusy("removing");
    setMessage(null);
    const result = await removeReceiptFromGardenWow(receiptId);
    setBusy(null);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error" });
      return;
    }
    setState(result.data);
    setMessage({ text: "Removed from GardenWow.", tone: "info" });
  }

  const destination = describeTarget(link?.status === "sent" ? linkTarget(link) : target);
  let headline = "Checking...";
  let detail: string | null = null;
  if (state) {
    if (link?.status === "sent") {
      headline = `In GardenWow: ${destination}`;
      detail = `Sent ${new Date(link.sent_at).toLocaleDateString("en-GB")}. The office can move it to another folder there.`;
    } else if (link?.status === "failed") {
      headline = "Couldn't send to GardenWow";
      detail = link.last_error;
    } else if (link?.status === "removed") {
      headline = "Removed from GardenWow";
      detail = `It will go to ${destination} if you send it again.`;
    } else if (missing.length) {
      headline = `Waiting for the ${missing.join(" and ")}`;
      detail = `It will be sent to ${destination} once you add the ${missing.join(" and ")} and save.`;
    } else {
      headline = "Not in GardenWow yet";
      detail = `It will go to ${destination}.`;
    }
  }

  const blocked = hasUnsavedChanges || busy !== null;
  const canSend = missing.length === 0;

  return (
    <section className="glass-panel rounded-[28px] p-5">
      <p className="eyebrow">GardenWow</p>
      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{headline}</p>
      {detail ? (
        <p
          className={`mt-1 text-xs ${
            link?.status === "failed" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {detail}
        </p>
      ) : null}

      {state ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {link?.status === "failed" || ((!link || link.status === "removed") && canSend) ? (
            <button
              type="button"
              onClick={() => void send()}
              disabled={blocked || !canSend}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "sending" ? "Sending..." : link?.status === "failed" ? "Retry" : "Send now"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setIsPickerOpen(true);
            }}
            disabled={blocked}
            className="secondary-button rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            Change folder
          </button>
          {link?.status === "sent" ? (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={blocked}
              className="secondary-button rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "removing" ? "Removing..." : "Remove"}
            </button>
          ) : null}
        </div>
      ) : null}

      {hasUnsavedChanges ? (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          Save your changes first. GardenWow is updated when you save.
        </p>
      ) : null}

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
          title="Choose a GardenWow folder"
          onClose={() => setIsPickerOpen(false)}
          onChoose={async (choice) => {
            setIsPickerOpen(false);
            if (canSend) {
              await send(choice);
              return;
            }
            // Not complete yet: just remember where it should go.
            const result = await sendReceiptToGardenWow(receiptId, choice);
            const nextState = result.ok ? result.data : result.state;
            if (nextState) {
              setState(nextState);
            }
            setMessage({
              text: `It will go to ${describeTarget(choice)} once it has a date and total.`,
              tone: "info",
            });
          }}
        />
      ) : null}
    </section>
  );
}

function linkTarget(link: NonNullable<GardenWowReceiptState["link"]>): GardenWowTarget {
  return {
    clientId: link.target_client_id,
    clientName: link.target_client_name,
    visitId: link.target_visit_id,
    visitLabel: link.target_visit_label,
  };
}

function describeTarget(target: GardenWowTarget | null) {
  if (!target?.clientId) {
    return "Unassigned";
  }
  const client = target.clientName ?? "the chosen client";
  return target.visitLabel ? `${client} (visit ${target.visitLabel})` : client;
}

// Picks a destination: Unassigned, or a client (and, with withVisits, one of
// their visits around the receipt date).
export function GardenWowPicker({
  onChoose,
  onClose,
  receiptDate = null,
  title,
  withVisits = true,
}: {
  onChoose: (target: GardenWowTarget) => void | Promise<void>;
  onClose: () => void;
  receiptDate?: string | null;
  title: string;
  withVisits?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<GardenWowClient[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [selectedClient, setSelectedClient] = useState<GardenWowClient | null>(null);
  const [visits, setVisits] = useState<GardenWowVisit[]>([]);
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
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
    if (!withVisits) {
      void onChoose({ clientId: client.id, clientName: client.name, visitId: null, visitLabel: null });
      return;
    }

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

  function confirmClient() {
    if (!selectedClient) {
      return;
    }
    const visit = visits.find((item) => item.id === selectedVisitId) ?? null;
    void onChoose({
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      visitId: visit?.id ?? null,
      visitLabel: visit ? formatVisitLabel(visit) : null,
    });
  }

  return (
    <section className="fixed inset-0 z-[75] bg-[rgba(5,10,18,0.46)] text-[var(--text-primary)]" onClick={onClose}>
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
            <p className="text-sm font-semibold">{selectedClient ? "Pick a visit" : title}</p>
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
              <PickerRow
                onClick={() => void onChoose({ clientId: null, clientName: null, visitId: null, visitLabel: null })}
                subtitle="The office files it into a client's folder later"
                title="Unassigned (sort later)"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Or find a client: name, email or postcode"
                className="field-control mt-3 w-full rounded-2xl px-4 py-3 text-sm outline-none"
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
                onClick={confirmClient}
                disabled={isLoadingVisits}
                className="mt-4 w-full rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {`Use ${selectedClient.name}`}
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
      className={`mt-1 w-full rounded-[22px] px-4 py-3 text-left transition ${
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
