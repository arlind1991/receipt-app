"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import { deleteAllUserReceipts, refreshAllAppCaches } from "@/lib/receipt-service";
import {
  getSessionBootstrapState,
  signOutCurrentUser,
} from "@/lib/supabase/session";

const showDevTools =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_HELPERS === "true";

export function AccountScreen() {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const email = useMemo(
    () => getSessionBootstrapState().user?.email ?? "Signed in",
    [],
  );

  async function handleSignOut() {
    setIsSigningOut(true);
    setStatusMessage(null);

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
    setStatusMessage(null);

    const result = await deleteAllUserReceipts();
    if (!result.ok) {
      setStatusMessage(result.error);
      setIsDeletingAll(false);
      return;
    }

    setStatusMessage("All receipts for this signed-in account were deleted.");
    setIsDeletingAll(false);
  }

  return (
    <main className="app-shell pb-28">
      <section className="mx-auto w-full max-w-md space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Account</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
          </div>
          <Link
            href="/camera"
            className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
          >
            Back to camera
          </Link>
        </div>

        {statusMessage ? <StatusBanner message={statusMessage} /> : null}

        <section className="glass-panel rounded-[28px] p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Signed-in email
          </p>
          <p className="mt-3 text-lg font-medium text-white">{email}</p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="mt-5 w-full rounded-full border border-white/12 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/7 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </section>

        {showDevTools ? (
          <section className="glass-panel rounded-[28px] p-5">
            <p className="eyebrow">Dev Helper</p>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              Clear all receipts owned by the currently signed-in account for testing.
            </p>
            <button
              type="button"
              onClick={() => void handleDeleteAll()}
              disabled={isDeletingAll}
              className="mt-5 w-full rounded-full border border-[rgba(255,139,158,0.28)] bg-[rgba(255,139,158,0.12)] px-4 py-3 text-sm font-medium text-[#ffd8de] transition hover:bg-[rgba(255,139,158,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeletingAll ? "Deleting test data..." : "Delete all my test receipts"}
            </button>
          </section>
        ) : null}
      </section>

      <AppNav />
    </main>
  );
}
