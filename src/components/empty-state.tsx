type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="soft-card rounded-[28px] p-6 text-center">
      <p className="eyebrow mb-3">Ready When You Are</p>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>
    </div>
  );
}
