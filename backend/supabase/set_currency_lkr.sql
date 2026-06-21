-- Force all businesses to use LKR.
alter table if exists public.businesses
  alter column currency_code set default 'LKR';

update public.businesses
set currency_code = 'LKR'
where currency_code is distinct from 'LKR';
