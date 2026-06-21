-- ==========================================
-- Flow.Ai Multi-Tenant + Chat Message Storage
-- ==========================================

-- 1) AGGRESSIVE CLEANUP (Fresh Slate)
drop table if exists public.messages cascade;
drop table if exists public.orders cascade;
drop table if exists public.products cascade;
drop table if exists public.customers cascade;
drop table if exists public.businesses cascade;
drop table if exists public.shops cascade;

drop function if exists public.set_updated_at() cascade;
drop function if exists public.handle_new_auth_user() cascade;

create extension if not exists "pgcrypto";

-- 2) BUSINESSES TABLE
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  business_name text not null,
  business_category text,
  support_email text,
  whatsapp_number text unique,
  meta_phone_id text,
  brand_voice text default 'Friendly assistant speaking English and Singlish.',
  currency_code text default 'LKR',
  time_zone text default '(GMT+05:30) Colombo',
  bot_enabled boolean not null default true,
  bot_auto_reply boolean not null default true,
  bot_escalation_mode text default 'on_manual_handoff',
  notif_order_created boolean not null default true,
  notif_order_delivered boolean not null default true,
  notif_low_stock boolean not null default true,
  security_two_factor boolean not null default false,
  security_session_minutes integer not null default 30,
  billing_plan text default 'Starter',
  billing_cycle text default 'Monthly',
  subscription_status text not null default 'active',
  billing_next_due_at timestamptz,
  billing_messages_used_period integer not null default 0,
  billing_buffer_notice_sent boolean not null default false,
  billing_quota_hard_block boolean not null default false,
  billing_last_marked_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Required for auth trigger upsert (on conflict owner_user_id)
create unique index if not exists idx_businesses_owner_user_id_unique
  on public.businesses(owner_user_id)
  where owner_user_id is not null;

-- 3) CUSTOMERS TABLE (Human handoff kill switch)
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.businesses(id) on delete cascade,
  phone_number text not null,
  bot_active boolean default true,
  created_at timestamptz not null default now(),
  unique(shop_id, phone_number)
);

-- 4) MESSAGES TABLE (AI conversation memory)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.businesses(id) on delete cascade,
  phone_number text not null,
  role text not null check (role in ('user', 'model', 'admin')),
  content text not null,
  created_at timestamptz not null default now(),
  reply_to_id uuid references public.messages(id) on delete set null,
  reply_snippet text,
  edited_at timestamptz,
  wa_message_id text
);

-- 5) PRODUCTS TABLE
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  category text,
  subcategory text,
  offering_type text not null default 'product' check (offering_type in ('product', 'service')),
  category_tags text[] not null default '{}',
  size_chart_image text,
  price numeric(12, 2) not null default 0,
  stock_count integer default 0,
  is_unlimited_stock boolean default false,
  is_featured boolean not null default false,
  images text[] not null default '{}',
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6) ORDERS TABLE
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.businesses(id) on delete cascade,
  customer_phone text not null,
  product_name text not null,
  total_price numeric(12, 2) not null default 0,
  delivery_address text,
  payment_method text,
  status text not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7) INDEXES + TRIGGERS
create index if not exists idx_customers_shop_phone on public.customers(shop_id, phone_number);
create index if not exists idx_messages_shop_phone_created_at on public.messages(shop_id, phone_number, created_at desc);
create index if not exists idx_products_shop_id on public.products(shop_id);
create index if not exists idx_orders_shop_id on public.orders(shop_id);
create index if not exists idx_orders_shop_id_created_at on public.orders(shop_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_businesses_set_updated_at on public.businesses;
drop trigger if exists trg_products_set_updated_at on public.products;
drop trigger if exists trg_orders_set_updated_at on public.orders;

create trigger trg_businesses_set_updated_at
before update on public.businesses
for each row execute procedure public.set_updated_at();

create trigger trg_products_set_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

create trigger trg_orders_set_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

-- 7b) Billing usage RPC (inbound message counter + buffer flags)
create or replace function public.increment_shop_billing_usage(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_used integer;
  old_sent boolean;
  plan_name text;
  new_used integer;
  incl integer;
  buf_extra integer;
  hard_cap integer;
  send_courtesy boolean;
begin
  select
    coalesce(b.billing_messages_used_period, 0),
    coalesce(b.billing_buffer_notice_sent, false),
    coalesce(nullif(trim(b.billing_plan), ''), 'Starter')
  into old_used, old_sent, plan_name
  from public.businesses b
  where b.id = p_shop_id
  for update;

  if not FOUND then
    return jsonb_build_object('ok', false, 'error', 'shop_not_found');
  end if;

  new_used := old_used + 1;

  incl := case plan_name
    when 'Growth' then 3000
    when 'Scale' then 6000
    else 1000
  end;

  buf_extra := greatest(1, floor(incl * 0.2)::integer);
  hard_cap := incl + buf_extra;

  send_courtesy := (new_used = incl) and not old_sent;

  update public.businesses
  set
    billing_messages_used_period = new_used,
    billing_buffer_notice_sent = old_sent or (new_used = incl),
    billing_quota_hard_block = (new_used >= hard_cap)
  where id = p_shop_id;

  return jsonb_build_object(
    'ok', true,
    'used', new_used,
    'included', incl,
    'buffer_extra', buf_extra,
    'hard_cap', hard_cap,
    'send_courtesy_whatsapp', send_courtesy,
    'plan', plan_name
  );
end;
$$;

revoke all on function public.increment_shop_billing_usage(uuid) from public;
revoke all on function public.increment_shop_billing_usage(uuid) from anon, authenticated;
grant execute on function public.increment_shop_billing_usage(uuid) to service_role;

-- 8) RLS (safe tenant isolation for app users)
alter table public.businesses enable row level security;
alter table public.customers enable row level security;
alter table public.messages enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

drop policy if exists businesses_select_own on public.businesses;
drop policy if exists businesses_insert_own on public.businesses;
drop policy if exists businesses_update_own on public.businesses;
drop policy if exists businesses_delete_own on public.businesses;

create policy businesses_select_own
on public.businesses
for select
to authenticated
using (owner_user_id = auth.uid() or owner_user_id is null);

create policy businesses_insert_own
on public.businesses
for insert
to authenticated
with check (owner_user_id = auth.uid() or owner_user_id is null);

create policy businesses_update_own
on public.businesses
for update
to authenticated
using (owner_user_id = auth.uid() or owner_user_id is null)
with check (owner_user_id = auth.uid() or owner_user_id is null);

create policy businesses_delete_own
on public.businesses
for delete
to authenticated
using (owner_user_id = auth.uid() or owner_user_id is null);

drop policy if exists customers_select_tenant on public.customers;
drop policy if exists customers_insert_tenant on public.customers;
drop policy if exists customers_update_tenant on public.customers;
drop policy if exists customers_delete_tenant on public.customers;

create policy customers_select_tenant
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = customers.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy customers_insert_tenant
on public.customers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = customers.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy customers_update_tenant
on public.customers
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = customers.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = customers.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy customers_delete_tenant
on public.customers
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = customers.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

drop policy if exists messages_select_tenant on public.messages;
drop policy if exists messages_insert_tenant on public.messages;
drop policy if exists messages_update_tenant on public.messages;
drop policy if exists messages_delete_tenant on public.messages;

create policy messages_select_tenant
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = messages.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy messages_insert_tenant
on public.messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = messages.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy messages_update_tenant
on public.messages
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = messages.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = messages.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy messages_delete_tenant
on public.messages
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = messages.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

drop policy if exists products_select_tenant on public.products;
drop policy if exists products_insert_tenant on public.products;
drop policy if exists products_update_tenant on public.products;
drop policy if exists products_delete_tenant on public.products;

create policy products_select_tenant
on public.products
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = products.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy products_insert_tenant
on public.products
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = products.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy products_update_tenant
on public.products
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = products.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = products.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy products_delete_tenant
on public.products
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = products.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

drop policy if exists orders_select_tenant on public.orders;
drop policy if exists orders_insert_tenant on public.orders;
drop policy if exists orders_update_tenant on public.orders;
drop policy if exists orders_delete_tenant on public.orders;

create policy orders_select_tenant
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = orders.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy orders_insert_tenant
on public.orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = orders.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy orders_update_tenant
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = orders.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = orders.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

create policy orders_delete_tenant
on public.orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = orders.shop_id
      and (b.owner_user_id = auth.uid() or b.owner_user_id is null)
  )
);

-- 9) AUTH TRIGGER (auto-create business on signup)
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- 10) INITIAL DATA (for immediate testing)
insert into public.businesses (business_name, whatsapp_number, support_email)
values ('Flow.Ai Official', '+94771234567', 'admin@flowai.lk')
on conflict (whatsapp_number) do nothing;

insert into public.products (
  shop_id,
  name,
  description,
  price,
  category,
  sizes,
  images,
  stock_count
)
values (
  (select id from public.businesses where business_name = 'Flow.Ai Official' limit 1),
  'Nike Airforce 1',
  'The Nike Air Force 1 Low White Black 2020 brings back the original 1982 design.',
  12000.00,
  'Shoes',
  '{UK 7, UK 8, UK 9, UK 10}',
  array[
    'https://skmsrkkcwufkgynvpods.supabase.co/storage/v1/object/public/New%20product/71qL9cJh-SL._AC_UY900_.jpg'
  ],
  10
)
on conflict do nothing;
