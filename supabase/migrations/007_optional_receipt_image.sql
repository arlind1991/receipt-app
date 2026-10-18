-- Receipts added by hand can be saved without a photo; one can be added later.
alter table public.receipts
  alter column image_path drop not null;
