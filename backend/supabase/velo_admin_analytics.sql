-- Velo admin analytics: daily aggregates (run in Supabase SQL editor).
-- Requires service_role; used by GET /api/velo-admin/analytics
-- Counts all rows in public.messages (user + model + admin). In-app replies use role model;
-- WhatsApp webhook inserts role user. Older SQL filtered role = user only and under-counted.

create or replace function public.velo_admin_message_daily_counts(p_days int default 30)
returns table(bucket_date date, total bigint)
language sql
security definer
set search_path = public
as $$
  select
    (date_trunc('day', m.created_at at time zone 'UTC'))::date as bucket_date,
    count(*)::bigint as total
  from public.messages m
  where m.created_at >= (timezone('utc', now()) - (p_days * interval '1 day'))
  group by 1
  order by 1;
$$;

create or replace function public.velo_admin_orders_daily_gmv(p_days int default 30)
returns table(bucket_date date, gmv numeric)
language sql
security definer
set search_path = public
as $$
  select
    (date_trunc('day', o.created_at at time zone 'UTC'))::date as bucket_date,
    coalesce(sum(o.total_price), 0)::numeric as gmv
  from public.orders o
  where o.created_at >= (timezone('utc', now()) - (p_days * interval '1 day'))
  group by 1
  order by 1;
$$;

revoke all on function public.velo_admin_message_daily_counts(int) from public;
revoke all on function public.velo_admin_message_daily_counts(int) from anon, authenticated;
grant execute on function public.velo_admin_message_daily_counts(int) to service_role;

revoke all on function public.velo_admin_orders_daily_gmv(int) from public;
revoke all on function public.velo_admin_orders_daily_gmv(int) from anon, authenticated;
grant execute on function public.velo_admin_orders_daily_gmv(int) to service_role;

-- Per-shop message totals since a UTC instant (Velo admin businesses table).
create or replace function public.velo_admin_message_counts_by_shop_since(p_since timestamptz)
returns table(shop_id uuid, message_count bigint)
language sql
security definer
set search_path = public
as $$
  select m.shop_id, count(*)::bigint as message_count
  from public.messages m
  where m.created_at >= p_since
  group by m.shop_id;
$$;

revoke all on function public.velo_admin_message_counts_by_shop_since(timestamptz) from public;
revoke all on function public.velo_admin_message_counts_by_shop_since(timestamptz) from anon, authenticated;
grant execute on function public.velo_admin_message_counts_by_shop_since(timestamptz) to service_role;
