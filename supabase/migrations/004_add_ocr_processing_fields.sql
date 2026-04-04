alter table public.receipts
add column if not exists processed_ocr_image_path text,
add column if not exists handwritten_notes text,
add column if not exists merchant_confidence text,
add column if not exists receipt_date_confidence text,
add column if not exists total_amount_confidence text;
