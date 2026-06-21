-- Run this in Supabase SQL Editor to fix Storage RLS errors
-- for product image uploads from the frontend.

-- Ensure expected buckets exist
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('New product', 'New product', true)
on conflict (id) do nothing;

-- Drop old policies if they exist
drop policy if exists "public_read_product_images" on storage.objects;
drop policy if exists "auth_insert_product_images" on storage.objects;
drop policy if exists "auth_update_product_images" on storage.objects;
drop policy if exists "auth_delete_product_images" on storage.objects;

-- Read for anyone (public bucket URLs)
create policy "public_read_product_images"
on storage.objects
for select
to public
using (bucket_id in ('product-images', 'New product'));

-- Writes for logged-in users from app
create policy "auth_insert_product_images"
on storage.objects
for insert
to authenticated
with check (bucket_id in ('product-images', 'New product'));

create policy "auth_update_product_images"
on storage.objects
for update
to authenticated
using (bucket_id in ('product-images', 'New product'))
with check (bucket_id in ('product-images', 'New product'));

create policy "auth_delete_product_images"
on storage.objects
for delete
to authenticated
using (bucket_id in ('product-images', 'New product'));
