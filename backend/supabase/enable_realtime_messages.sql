-- Run once in the Supabase SQL editor if new customer/bot messages only appear
-- after a manual refresh. This adds `public.messages` to the Realtime publication
-- so the dashboard can receive postgres_changes events.
--
-- If you see "already member of publication", the table is already enabled — safe to ignore.

alter publication supabase_realtime add table public.messages;
