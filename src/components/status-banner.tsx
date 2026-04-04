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
      ? "danger-card"
      : "border-[var(--border-strong)] bg-[var(--success-bg)] text-[var(--text-primary)]";

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${toneClass}`}
    >
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="secondary-button shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
