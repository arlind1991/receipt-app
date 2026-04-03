export function formatCurrency(value: number | null, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: normalizeCurrency(currency),
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

export function normalizeCurrency(currency: string | null | undefined) {
  return currency && currency.length === 3 ? currency.toUpperCase() : "GBP";
}
