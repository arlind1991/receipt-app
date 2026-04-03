create extension if not exists "pgcrypto";

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists folders_user_id_name_idx
  on public.folders (user_id, lower(name));

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  image_path text not null,
  status text not null default 'uploaded',
  merchant_name text,
  receipt_date date,
  total_amount numeric(12,2),
  vat_amount numeric(12,2),
  currency text,
  category text,
  raw_ocr_text text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists receipts_set_updated_at on public.receipts;
create trigger receipts_set_updated_at
before update on public.receipts
for each row
execute function public.set_updated_at();

alter table public.folders enable row level security;
alter table public.receipts enable row level security;

create policy "folders_select_own"
on public.folders
for select
to authenticated
using (auth.uid() = user_id);

create policy "folders_insert_own"
on public.folders
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "folders_update_own"
on public.folders
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "folders_delete_own"
on public.folders
for delete
to authenticated
using (auth.uid() = user_id);

create policy "receipts_select_own"
on public.receipts
for select
to authenticated
using (auth.uid() = user_id);

create policy "receipts_insert_own"
on public.receipts
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "receipts_update_own"
on public.receipts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "receipts_delete_own"
on public.receipts
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "receipt_images_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "receipt_images_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "receipt_images_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "receipt_images_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);
