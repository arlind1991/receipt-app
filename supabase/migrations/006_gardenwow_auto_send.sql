-- Automatic sending to GardenWow.
--
-- receipts.gardenwow_* is where the receipt should go (chosen on the camera
-- screen or the receipt page; no client = the Unassigned folder).
-- receipt_external_links records what GardenWow actually has.

alter table public.receipts
  add column if not exists gardenwow_client_id text,
  add column if not exists gardenwow_client_name text,
  add column if not exists gardenwow_visit_id text,
  add column if not exists gardenwow_visit_label text;

-- No client = Unassigned.
alter table public.receipt_external_links
  alter column target_client_id drop not null;

alter table public.receipt_external_links
  add column if not exists status text not null default 'sent',
  add column if not exists last_error text,
  -- Fingerprint of what was sent, so saving unchanged details doesn't resend.
  add column if not exists sent_hash text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.receipt_external_links
  drop constraint if exists receipt_external_links_status_check;

alter table public.receipt_external_links
  add constraint receipt_external_links_status_check
  check (status in ('sent', 'failed', 'removed'));
