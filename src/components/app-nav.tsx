"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/camera", label: "Capture" },
  { href: "/receipts", label: "Receipts" },
  { href: "/account", label: "Account" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="glass-panel fixed right-4 bottom-4 left-4 z-40 rounded-full px-2 py-2 md:left-1/2 md:w-[360px] md:-translate-x-1/2">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-4 py-3 text-center text-sm font-medium transition ${
                active
                  ? "bg-[var(--accent)] text-[#072018]"
                  : "text-[var(--text-secondary)] hover:bg-white/6 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
