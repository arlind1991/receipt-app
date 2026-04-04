export const BASE_RECEIPT_SELECT = [
  "id",
  "user_id",
  "folder_id",
  "image_path",
  "status",
  "merchant_name",
  "merchant_confidence",
  "receipt_date",
  "receipt_date_confidence",
  "total_amount",
  "total_amount_confidence",
  "vat_amount",
  "currency",
  "category",
  "raw_ocr_text",
  "parsed_ocr_json",
  "extraction_error",
  "created_at",
  "updated_at",
].join(", ");

export const BASE_RECEIPT_SELECT_WITH_FOLDER = `${BASE_RECEIPT_SELECT}, folders(name)`;

export function isMissingOptionalReceiptColumnError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("receipts.processed_ocr_image_path") ||
    normalized.includes("receipts.handwritten_notes") ||
    normalized.includes("processed_ocr_image_path column") ||
    normalized.includes("handwritten_notes column")
  );
}
