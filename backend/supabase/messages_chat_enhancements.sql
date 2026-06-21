-- Optional: run once in Supabase SQL Editor for reply + edit metadata on messages.
-- Required for Reply / Edit indicators in the admin chat UI.

alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

alter table public.messages
  add column if not exists reply_snippet text;

alter table public.messages
  add column if not exists edited_at timestamptz;

alter table public.messages
  add column if not exists wa_message_id text;

create index if not exists idx_messages_reply_to on public.messages(reply_to_id);

comment on column public.messages.reply_to_id is 'Message this row replies to (dashboard UI).';
comment on column public.messages.reply_snippet is 'Quoted preview of the replied-to message.';
comment on column public.messages.edited_at is 'Set when content was last edited from the dashboard.';
comment on column public.messages.wa_message_id is 'WhatsApp Cloud API message id (wamid) when this row was delivered via Meta; used to edit the bubble on the customer''s WhatsApp.';
