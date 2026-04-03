type StatusBannerProps = {
  tone?: "info" | "error";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function StatusBanner({
  tone = "info",
  message,
  actionLabel,
  onAction,
}: StatusBannerProps) {
  const toneClass =
    tone === "error"
      ? "border-[rgba(255,139,158,0.28)] bg-[rgba(255,139,158,0.12)] text-[#ffd8de]"
      : "border-[var(--border-strong)] bg-[rgba(143,247,208,0.08)] text-[var(--text-primary)]";

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${toneClass}`}
    >
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-full border border-white/14 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/8"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
