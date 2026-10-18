"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ExpensesIcon,
  NewsIcon,
  PlusIcon,
  ReportsIcon,
  SettingsIcon,
} from "@/components/ui/icons";

const leftItems = [
  { href: "/receipts", label: "Expenses", Icon: ExpensesIcon },
  { href: "/reports", label: "Reports", Icon: ReportsIcon },
];

const rightItems = [
  { href: "/news", label: "News", Icon: NewsIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

// Bottom tab bar shown on every main screen, with the add-receipt button in the middle.
export function AppNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/receipts"
      ? pathname === "/receipts" || (pathname.startsWith("/receipts/") && pathname !== "/receipts/new")
      : pathname.startsWith(href);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-soft)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="mx-auto grid h-[68px] max-w-md grid-cols-5 items-center">
        {leftItems.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
        <div className="flex justify-center">
          <Link
            href="/receipts/new"
            aria-label="Add receipt"
            className="-mt-8 flex h-[62px] w-[62px] items-center justify-center rounded-full bg-[var(--pink)] text-white shadow-[0_8px_20px_rgba(242,56,107,0.4)] transition hover:bg-[var(--pink-strong)]"
          >
            <PlusIcon className="h-8 w-8" />
          </Link>
        </div>
        {rightItems.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
      </div>
    </nav>
  );
}

function NavLink({
  active,
  href,
  Icon,
  label,
}: {
  active: boolean;
  href: string;
  Icon: (props: { className?: string }) => React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center gap-1 text-[0.72rem] font-semibold transition ${
        active ? "text-[var(--text-strong)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}
    >
      <Icon className="h-7 w-7" />
      {label}
    </Link>
  );
}
