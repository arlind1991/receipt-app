export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FolderRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type ReceiptRow = {
  id: string;
  user_id: string;
  folder_id: string | null;
  image_path: string;
  status: string;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  currency: string | null;
  category: string | null;
  raw_ocr_text: string | null;
  parsed_ocr_json: string | null;
  extraction_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptInsert = {
  id: string;
  user_id: string;
  folder_id: string | null;
  image_path: string;
  status: string;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  currency: string | null;
  category: string | null;
  raw_ocr_text: string | null;
  parsed_ocr_json: string | null;
  extraction_error: string | null;
};

export type ReceiptListItem = ReceiptRow & {
  folder_name: string | null;
  signed_image_url: string | null;
};

export type ReceiptDetail = ReceiptListItem;

export type ReceiptEditableFields = {
  currency: string | null;
  folder_id: string | null;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  category: string | null;
};

export type DuplicateReceiptCandidate = {
  id: string;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  created_at: string;
  similarity: number;
};

export type ReceiptDetectionBox = {
  height: number;
  index: number;
  width: number;
  x: number;
  y: number;
};

export type ReceiptDetectionResult = {
  boxes: ReceiptDetectionBox[];
  detectedMultiple: boolean;
  receiptCount: number;
};
