-- Maps WhatsApp Cloud API "phone_number_id" (from webhooks) → businesses row.
-- Run in Supabase SQL editor if the column is missing.

alter table if exists public.businesses
  add column if not exists meta_phone_id text;

create index if not exists idx_businesses_meta_phone_id
  on public.businesses (meta_phone_id)
  where meta_phone_id is not null;
