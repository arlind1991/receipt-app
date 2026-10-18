"use client";

// Turquoise header used at the top of every screen (it also sits behind the
// iOS status bar), with optional left/right actions and a tab strip.

export function BrandHeader({
  children,
  left,
  right,
  title,
}: {
  children?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  title?: string;
}) {
  return (
    <header className="brand-header">
      <div className="mx-auto grid min-h-[52px] max-w-md grid-cols-[1fr_auto_1fr] items-center px-4">
        <div className="justify-self-start">{left}</div>
        {title ? <h1 className="text-xl font-extrabold tracking-tight">{title}</h1> : <span />}
        <div className="justify-self-end">{right}</div>
      </div>
      {children}
    </header>
  );
}

export function TabStrip<T extends string>({
  onChange,
  tabs,
  value,
}: {
  onChange: (value: T) => void;
  tabs: Array<{ badge?: number; label: string; value: T }>;
  value: T;
}) {
  return (
    <div className="bg-[var(--brand-strong)]">
      <div
        className="mx-auto grid max-w-md"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        role="tablist"
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.value)}
              className={`relative py-3.5 text-sm font-bold tracking-[0.04em] uppercase transition ${
                active ? "text-white" : "text-[var(--brand-ink)] hover:text-white/80"
              }`}
            >
              {tab.label}
              {tab.badge ? (
                <span className="absolute top-1.5 ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pink)] px-1 text-[0.68rem] text-white">
                  {tab.badge}
                </span>
              ) : null}
              <span
                className={`absolute inset-x-0 bottom-0 h-[3px] ${active ? "bg-white" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Two-option segmented control used on the add/edit receipt screens.
export function Segmented<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-soft)] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg py-2.5 text-[1.02rem] font-semibold transition ${
              active ? "bg-[var(--pink)] text-white shadow-sm" : "text-[var(--text-secondary)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
