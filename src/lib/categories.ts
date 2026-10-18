// HMRC Self Assessment (SA103F) allowable expense categories, used for adding,
// editing and reporting receipts, and given to Claude when it reads one.

export const EXPENSE_CATEGORIES = [
  "Costs of goods bought for resale or goods used",
  "Construction industry payments to subcontractors",
  "Wages, salaries and other staff costs",
  "Car, van and travel expenses",
  "Rent, rates, power and insurance costs",
  "Repairs and maintenance of property and equipment",
  "Phone, fax, stationery and other office costs",
  "Advertising and business entertainment costs",
  "Interest on bank and other loans",
  "Bank, credit card and other financial charges",
  "Accountancy, legal and other professional fees",
  "Other business expenses",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = "Other business expenses";

// Receipts saved before the switch used everyday labels; show them under the
// closest HMRC category.
const LEGACY_CATEGORY_MAP: Record<string, ExpenseCategory> = {
  "materials & tools": "Costs of goods bought for resale or goods used",
  groceries: "Costs of goods bought for resale or goods used",
  shopping: "Costs of goods bought for resale or goods used",
  "equipment hire": "Repairs and maintenance of property and equipment",
  fuel: "Car, van and travel expenses",
  travel: "Car, van and travel expenses",
  dining: "Other business expenses",
  healthcare: "Other business expenses",
  other: "Other business expenses",
};

export function toExpenseCategory(value: string | null | undefined): ExpenseCategory | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const exact = EXPENSE_CATEGORIES.find((category) => category.toLowerCase() === trimmed.toLowerCase());
  return exact ?? LEGACY_CATEGORY_MAP[trimmed.toLowerCase()] ?? DEFAULT_EXPENSE_CATEGORY;
}
