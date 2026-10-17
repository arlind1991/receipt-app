-- Records receipts sent to an external system (currently only the GardenWow
-- platform). One row per receipt per provider. Rows are written by the server
-- with the service role; users can only read their own.
create table if not exists public.receipt_external_links (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gardenwow')),
  external_id text not null,
  target_client_id text not null,
  target_client_name text,
  target_visit_id text,
  target_visit_label text,
  sent_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists receipt_external_links_receipt_provider_idx
  on public.receipt_external_links (receipt_id, provider);

alter table public.receipt_external_links enable row level security;

create policy "receipt_external_links_select_own"
on public.receipt_external_links
for select
to authenticated
using (auth.uid() = user_id);
