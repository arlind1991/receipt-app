export const BASE_RECEIPT_SELECT = [
  "id",
  "user_id",
  "folder_id",
  "image_path",
  "status",
  "merchant_name",
  "receipt_date",
  "total_amount",
  "vat_amount",
  "currency",
  "category",
  "raw_ocr_text",
  "notes",
  "parsed_ocr_json",
  "extraction_error",
  "created_at",
  "updated_at",
].join(", ");

export const BASE_RECEIPT_SELECT_WITH_FOLDER = `${BASE_RECEIPT_SELECT}, folders(name)`;
