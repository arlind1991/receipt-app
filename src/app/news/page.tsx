import { AppNav } from "@/components/app-nav";
import { SessionGate } from "@/components/auth/session-gate";
import { BrandHeader } from "@/components/ui/brand-header";
import { NewsIcon } from "@/components/ui/icons";

export default function NewsPage() {
  return (
    <SessionGate requireAuth>
      <main className="tab-screen">
        <BrandHeader title="News" />
        <section className="mx-auto flex max-w-md flex-col items-center px-8 py-20 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-strong)]">
            <NewsIcon className="h-10 w-10" />
          </span>
          <p className="mt-6 text-xl font-bold text-[var(--brand-strong)]">News is coming soon</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            Updates about SnapReceipt and tips for keeping your expenses in order will appear here.
          </p>
        </section>
        <AppNav />
      </main>
    </SessionGate>
  );
}
