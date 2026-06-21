-- Safe migration for existing projects (no table drops)
-- Run this in Supabase SQL Editor for live databases.

-- Required for auth trigger upsert:
-- handle_new_auth_user() uses "on conflict (owner_user_id) do nothing"
create unique index if not exists idx_businesses_owner_user_id_unique
  on public.businesses(owner_user_id)
  where owner_user_id is not null;

alter table if exists public.businesses
  add column if not exists currency_code text default 'LKR';

alter table if exists public.businesses
  add column if not exists time_zone text default '(GMT+05:30) Colombo';

alter table if exists public.businesses
  add column if not exists bot_enabled boolean not null default true;

alter table if exists public.businesses
  add column if not exists bot_auto_reply boolean not null default true;

alter table if exists public.businesses
  add column if not exists bot_escalation_mode text default 'on_manual_handoff';

alter table if exists public.businesses
  add column if not exists notif_order_created boolean not null default true;

alter table if exists public.businesses
  add column if not exists notif_order_delivered boolean not null default true;

alter table if exists public.businesses
  add column if not exists notif_low_stock boolean not null default true;

alter table if exists public.businesses
  add column if not exists security_two_factor boolean not null default false;

alter table if exists public.businesses
  add column if not exists security_session_minutes integer not null default 30;

alter table if exists public.businesses
  add column if not exists billing_plan text default 'Starter';

alter table if exists public.businesses
  add column if not exists billing_cycle text default 'Monthly';

alter table if exists public.products
  add column if not exists subcategory text;

alter table if exists public.products
  add column if not exists offering_type text not null default 'product';

alter table if exists public.products
  add column if not exists category_tags text[] not null default '{}';

alter table if exists public.products
  add column if not exists size_chart_image text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_offering_type_check'
  ) then
    alter table public.products
      add constraint products_offering_type_check
      check (offering_type in ('product', 'service'));
  end if;
end;
$$;

-- Make auth trigger independent from unique-index conflict inference.
-- This preserves behavior and avoids "database fetch/save" issues on projects
-- where old trigger/index state is inconsistent.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.businesses (owner_user_id, support_email, business_name)
  select
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', split_part(new.email, '@', 1))
  where not exists (
    select 1 from public.businesses b where b.owner_user_id = new.id
  );

  return new;
end;
$$;

-- Rollback of business-number routing logic (restore previous backend model)
do $$
begin
  if to_regclass('public.whatsapp_business_numbers') is not null then
    execute 'drop policy if exists whatsapp_numbers_select_tenant on public.whatsapp_business_numbers';
    execute 'drop policy if exists whatsapp_numbers_insert_tenant on public.whatsapp_business_numbers';
    execute 'drop policy if exists whatsapp_numbers_update_tenant on public.whatsapp_business_numbers';
    execute 'drop policy if exists whatsapp_numbers_delete_tenant on public.whatsapp_business_numbers';
  end if;
end;
$$;

drop function if exists public.resolve_shop_by_whatsapp_number(text);
drop function if exists public.normalize_phone_number(text);

drop table if exists public.whatsapp_business_numbers cascade;
