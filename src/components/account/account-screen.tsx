"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import { BrandHeader } from "@/components/ui/brand-header";
import {
  CameraIcon,
  ChevronRightIcon,
  LeafIcon,
  ReportsIcon,
  SignOutIcon,
  UserIcon,
} from "@/components/ui/icons";
import { isGardenWowEnabled } from "@/lib/gardenwow/client";
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
  const [gardenWowOn, setGardenWowOn] = useState(false);
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
    const load = async () => {
      const sessionUser = user ?? (await ensureBrowserSession());
      if (!sessionUser) {
        setReceiptCount(null);
        return;
      }

      void isGardenWowEnabled(sessionUser.id).then(setGardenWowOn);
      const result = await fetchReceiptCount(sessionUser.id);
      if (result.ok) {
        setReceiptCount(result.data);
      }
    };

    void load();
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

  return (
    <main className="tab-screen">
      <BrandHeader title="Settings">
        <div className="mx-auto flex max-w-md items-center gap-4 px-5 pt-3 pb-6">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-[var(--brand-strong)] text-[var(--brand-ink)]">
            <UserIcon className="h-9 w-9" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{email}</p>
            <p className="text-sm font-semibold text-white/80">
              Signed in with {providerInfo} · since {createdDateLabel}
            </p>
          </div>
        </div>
        <div className="bg-[var(--brand-strong)] py-4 text-center">
          <p className="text-lg font-extrabold tracking-wide uppercase">
            <span className="mr-2 inline-block min-w-9 rounded bg-[var(--brand-ink)] px-2 py-0.5 text-center">
              {receiptCount ?? "…"}
            </span>
            Receipts saved
          </p>
        </div>
      </BrandHeader>

      <section className="mx-auto w-full max-w-md">
        {statusBanner ? (
          <div className="p-4">
            <StatusBanner tone={statusBanner.tone} message={statusBanner.message} />
          </div>
        ) : null}

        <div className="divide-y divide-[var(--border-soft)] bg-[var(--surface)]">
          <SettingsRow
            href="/camera"
            iconClass="bg-[var(--pink)]"
            icon={<CameraIcon className="h-6 w-6" />}
            title="Scan a receipt"
            subtitle="Take a photo and fill in the details automatically"
          />
          <SettingsRow
            href="/reports"
            iconClass="bg-[#3d8bfd]"
            icon={<ReportsIcon className="h-6 w-6" />}
            title="Reports"
            subtitle="Totals by tax category and tag"
          />
          {gardenWowOn ? (
            <SettingsRow
              iconClass="bg-[#2f9e5b]"
              icon={<LeafIcon className="h-6 w-6" />}
              title="GardenWow"
              subtitle="Connected. Receipts are filed in GardenWow automatically"
            />
          ) : null}
        </div>

        <div className="mt-6 divide-y divide-[var(--border-soft)] bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-[var(--nav-hover)] disabled:opacity-60"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#8a99a6] text-white">
              <SignOutIcon className="h-6 w-6" />
            </span>
            <span className="text-[1.1rem] text-[var(--text-strong)]">
              {isSigningOut ? "Logging out..." : "Log out"}
            </span>
          </button>
        </div>

        {showDevTools ? (
          <div className="danger-card m-4 rounded-2xl p-4">
            <p className="text-sm font-bold">Delete all my test receipts</p>
            <p className="mt-1 text-sm leading-6">
              Removes receipts owned by this signed-in account. Only shown in development.
            </p>
            <button
              type="button"
              onClick={() => void handleDeleteAll()}
              disabled={isDeletingAll}
              className="mt-3 w-full rounded-full border border-[var(--danger-border)] bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {isDeletingAll ? "Deleting test data..." : "Delete all test receipts"}
            </button>
          </div>
        ) : null}
      </section>

      <AppNav />
    </main>
  );
}

function SettingsRow({
  href,
  icon,
  iconClass,
  subtitle,
  title,
}: {
  href?: string;
  icon: React.ReactNode;
  iconClass: string;
  subtitle?: string;
  title: string;
}) {
  const content = (
    <>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${iconClass}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.1rem] text-[var(--text-strong)]">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block text-sm text-[var(--text-secondary)]">{subtitle}</span>
        ) : null}
      </span>
      {href ? <ChevronRightIcon className="h-5 w-5 shrink-0 text-[var(--text-muted)]" /> : null}
    </>
  );

  return href ? (
    <Link href={href} className="flex items-center gap-4 px-4 py-4 transition hover:bg-[var(--nav-hover)]">
      {content}
    </Link>
  ) : (
    <div className="flex items-center gap-4 px-4 py-4">{content}</div>
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
