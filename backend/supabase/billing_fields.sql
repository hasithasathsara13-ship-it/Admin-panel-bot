-- Billing: subscription, usage, 20% message buffer, mark-paid fields.
-- Run once in Supabase SQL Editor (or via migration) on existing projects.

alter table if exists public.businesses
  add column if not exists subscription_status text not null default 'active';

alter table if exists public.businesses
  add column if not exists billing_next_due_at timestamptz;

alter table if exists public.businesses
  add column if not exists billing_messages_used_period integer not null default 0;

alter table if exists public.businesses
  add column if not exists billing_buffer_notice_sent boolean not null default false;

alter table if exists public.businesses
  add column if not exists billing_quota_hard_block boolean not null default false;

alter table if exists public.businesses
  add column if not exists billing_last_marked_paid_at timestamptz;

comment on column public.businesses.subscription_status is 'active | past_due | canceled — past_due triggers grace vs bot block in app.';
comment on column public.businesses.billing_next_due_at is 'When the current period payment is due; grace = this + 3 days (see app constant).';
comment on column public.businesses.billing_messages_used_period is 'Inbound billable messages counted this period (webhook increments).';
comment on column public.businesses.billing_buffer_notice_sent is 'True after owner WhatsApp courtesy sent at 100% plan usage.';
comment on column public.businesses.billing_quota_hard_block is 'True when usage reached plan included + 20% buffer; stop automated bot replies.';
comment on column public.businesses.billing_last_marked_paid_at is 'Last platform mark-paid timestamp.';

-- Atomic increment + buffer / hard-cap flags (service_role only).
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
