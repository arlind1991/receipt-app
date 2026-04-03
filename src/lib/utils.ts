export function formatCurrency(value: number | null) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value ?? 0);
}

export function formatReceiptDate(receiptDate: string | null, createdAt: string) {
  const source = receiptDate ? new Date(receiptDate) : new Date(createdAt);

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(source);
}
