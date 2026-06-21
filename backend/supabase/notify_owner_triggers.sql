-- Sends WhatsApp notifications to the business owner via your Next.js API.
--
-- Requirements:
-- - Your deployed app must expose `POST /api/owner-notify`
-- - Set `INTERNAL_WEBHOOK_SECRET` in the Next.js environment
-- - Replace the URL below with your real domain
-- - Supabase project must have pg_net available (Supabase supports this)
--
-- This script creates:
-- 1) Trigger on `public.orders` INSERT → notify owner (new order)
-- 2) Trigger on `public.messages` INSERT when content matches the handoff phrase
--
-- IMPORTANT:
-- This runs inside the database. It does NOT depend on the dashboard being open.

create extension if not exists pg_net;

-- Change this:
-- Example: https://myapp.com/api/owner-notify
do $$
begin
  -- Just a placeholder check so it’s hard to forget editing the URL.
  if 'https://YOUR_DOMAIN/api/owner-notify' like '%YOUR_DOMAIN%' then
    raise notice 'Edit notify_owner_triggers.sql: replace https://YOUR_DOMAIN/api/owner-notify with your real domain';
  end if;
end$$;

create or replace function public._notify_owner_http(payload jsonb)
returns void
language plpgsql
as $$
declare
  url text := 'https://YOUR_DOMAIN/api/owner-notify';
  headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', current_setting('app.internal_webhook_secret', true)
  );
begin
  perform net.http_post(
    url := url,
    headers := headers,
    body := payload
  );
end;
$$;

-- Trigger: orders → new order notification
create or replace function public.trg_notify_owner_order_created()
returns trigger
language plpgsql
as $$
begin
  perform public._notify_owner_http(
    jsonb_build_object(
      'type', 'order_created',
      'shop_id', new.shop_id,
      'order', jsonb_build_object(
        'id', new.id,
        'customer_phone', new.customer_phone,
        'product_name', new.product_name,
        'total_price', new.total_price,
        'payment_method', new.payment_method,
        'delivery_address', new.delivery_address,
        'status', new.status
      )
    )
  );
  return new;
end;
$$;

drop trigger if exists notify_owner_order_created on public.orders;
create trigger notify_owner_order_created
after insert on public.orders
for each row
execute function public.trg_notify_owner_order_created();

-- Trigger: messages → human handoff notification
-- Phrase requested by you:
-- "I will transfer you to a representative, hold on."
create or replace function public.trg_notify_owner_human_handoff()
returns trigger
language plpgsql
as $$
declare
  content_trim text := btrim(new.content);
begin
  if content_trim = 'I will transfer you to a representative, hold on.' then
    perform public._notify_owner_http(
      jsonb_build_object(
        'type', 'human_handoff',
        'shop_id', new.shop_id,
        'message', jsonb_build_object(
          'id', new.id,
          'phone_number', new.phone_number,
          'content', new.content
        )
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_owner_human_handoff on public.messages;
create trigger notify_owner_human_handoff
after insert on public.messages
for each row
execute function public.trg_notify_owner_human_handoff();

-- If you need to set the secret inside Postgres (Supabase SQL editor):
-- select set_config('app.internal_webhook_secret', '<same as INTERNAL_WEBHOOK_SECRET>', false);
--
-- In production, store it as a database setting / vault secret and map it into
-- `app.internal_webhook_secret` depending on your platform.

