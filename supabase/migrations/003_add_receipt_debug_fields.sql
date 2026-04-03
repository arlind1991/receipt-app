alter table public.receipts
add column if not exists parsed_ocr_json text,
add column if not exists extraction_error text;
