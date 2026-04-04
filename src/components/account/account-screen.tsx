"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import {
  deleteAllUserReceipts,
  fetchReceiptCount,
  refreshAllAppCaches,
} from "@/lib/receipt-service";
import {
  ensureBrowserSession,
  getSessionBootstrapState,
  signOutCurrentUser,
  subscribeToSessionBootstrap,
} from "@/lib/supabase/session";
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "@/lib/local-storage";

const showDevTools =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_HELPERS === "true";

export function AccountScreen() {
  const router = useRouter();
  const [statusBanner, setStatusBanner] = useState<{
    message: string;
    tone: "error" | "info";
  } | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [receiptCount, setReceiptCount] = useState<number | null>(null);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  const [user, setUser] = useState(getSessionBootstrapState().user);
  const email = useMemo(() => user?.email ?? "Signed in", [user]);
  const providerInfo = useMemo(() => getProviderInfo(user), [user]);
  const createdDateLabel = useMemo(() => formatAccountCreatedDate(user), [user]);

  useEffect(() => {
    return subscribeToSessionBootstrap((state) => {
      setUser(state.user);
    });
  }, []);

  useEffect(() => {
    const loadReceiptCount = async () => {
      const sessionUser = user ?? (await ensureBrowserSession());
      if (!sessionUser) {
        setReceiptCount(null);
        return;
      }

      const result = await fetchReceiptCount(sessionUser.id);
      if (!result.ok) {
        return;
      }

      setReceiptCount(result.data);
    };

    void loadReceiptCount();
  }, [user]);

  async function handleSignOut() {
    setIsSigningOut(true);
    setStatusBanner(null);

    await signOutCurrentUser();
    await refreshAllAppCaches();
    router.replace("/");
    router.refresh();
  }

  async function handleDeleteAll() {
    const confirmed = window.confirm(
      "Delete all receipts belonging to this signed-in test account?",
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingAll(true);
    setStatusBanner(null);

    const result = await deleteAllUserReceipts();
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
      setIsDeletingAll(false);
      return;
    }

    setReceiptCount(0);
    setStatusBanner({
      message: "All receipts for this signed-in account were deleted.",
      tone: "info",
    });
    setIsDeletingAll(false);
  }

  function handleThemeChange(preference: ThemePreference) {
    setThemePreference(preference);
    setThemePreferenceState(preference);

    if (preference === "system") {
      document.documentElement.removeAttribute("data-theme");
      return;
    }

    document.documentElement.setAttribute("data-theme", preference);
  }

  return (
    <main className="app-shell app-shell-with-nav">
      <section className="mx-auto w-full max-w-md space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Account</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your account</h1>
          </div>
          <Link
            href="/camera"
            className="secondary-button rounded-full px-4 py-2 text-sm transition"
          >
            Back to camera
          </Link>
        </div>

        {statusBanner ? (
          <StatusBanner tone={statusBanner.tone} message={statusBanner.message} />
        ) : null}

        <section className="glass-panel rounded-[28px] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Profile</p>
              <p className="mt-3 text-lg font-medium text-[var(--text-primary)]">{email}</p>
            </div>
            <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              {providerInfo}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <AccountStat
              label="Saved receipts"
              value={receiptCount != null ? String(receiptCount) : "Loading..."}
            />
            <AccountStat label="Member since" value={createdDateLabel} />
          </div>

          <div className="mt-5 rounded-[22px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Signed in as
            </p>
            <p className="mt-2 text-sm text-[var(--text-primary)]">{email}</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Auth provider: {providerInfo}
            </p>
          </div>

          <div className="mt-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Theme
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["system", "light", "dark"] as ThemePreference[]).map((option) => {
                const active = themePreference === option;

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleThemeChange(option)}
                    className={`rounded-full px-4 py-3 text-sm font-medium capitalize transition ${
                      active
                        ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
                        : "secondary-button"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[28px] p-5">
          <p className="eyebrow">Actions</p>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            Keep things simple for now: sign out when you are done, or clear test data if you are
            using a dev account.
          </p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="secondary-button mt-5 w-full rounded-full px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>

          {showDevTools ? (
            <div className="danger-card mt-3 rounded-[22px] p-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Delete all my test receipts
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                Removes receipts owned by this signed-in account. Use this only for safe testing.
              </p>
              <button
                type="button"
                onClick={() => void handleDeleteAll()}
                disabled={isDeletingAll}
                className="danger-card mt-4 w-full rounded-full px-4 py-3 text-sm font-medium transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingAll ? "Deleting test data..." : "Delete all test receipts"}
              </button>
            </div>
          ) : null}
        </section>
      </section>

      <AppNav />
    </main>
  );
}

function getProviderInfo(user: User | null) {
  if (!user) {
    return "Unknown";
  }

  const providers = new Set<string>();
  const primaryProvider = user.app_metadata?.provider;
  if (typeof primaryProvider === "string" && primaryProvider.length > 0) {
    providers.add(primaryProvider);
  }

  user.identities?.forEach((identity) => {
    if (identity.provider) {
      providers.add(identity.provider);
    }
  });

  if (providers.size === 0) {
    return "Email";
  }

  return [...providers]
    .map((provider) => {
      if (provider === "google") return "Google";
      if (provider === "apple") return "Apple";
      if (provider === "email") return "Email";
      return provider;
    })
    .join(", ");
}

function formatAccountCreatedDate(user: User | null) {
  if (!user?.created_at) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(user.created_at));
}

function AccountStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
