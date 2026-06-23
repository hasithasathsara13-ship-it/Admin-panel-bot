-- Add WABA ID and per-business Meta API token columns
alter table public.businesses
  add column if not exists waba_id text default null;

alter table public.businesses
  add column if not exists meta_api_token text default null;

comment on column public.businesses.waba_id is 'WhatsApp Business Account ID from Meta — used for template management per business.';
comment on column public.businesses.meta_api_token is 'Per-business Meta API token (overrides global env if set).';
