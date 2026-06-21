## Supabase Multi-Tenant Implementation

This project should use a **single shared schema** with tenant isolation by `shop_id` (business id), not separate tables per user.

### Why not create tables for every user?

- It does not scale.
- It is hard to query across tenants for analytics/admin.
- Schema changes become expensive.
- Supabase RLS is designed for shared tables + row isolation.

### Tenant model

- `auth.users` = authentication accounts.
- `businesses` = one row per business (owner = `owner_user_id`).
- Business data tables (`orders`, `products`) carry `shop_id` FK to `businesses.id`.
- Row Level Security policies ensure users only access rows for their own business.

### Setup steps

1. Open Supabase SQL editor.
2. Run `backend/supabase/schema.sql`.
3. In Supabase Auth, create users (or sign up from app).
4. On first user creation, trigger auto-creates `businesses` row.
5. App login resolves tenant id and stores it as `active_shop_id`.

### Existing frontend behavior compatibility

- Current pages already query by `.eq("shop_id", activeShopId)`.
- No UI changes required.
- New auth-to-tenant mapping is now `businesses.owner_user_id -> businesses.id`.

### Recommended next backend step

Move direct client writes to server endpoints (or Supabase Edge Functions) for stricter validation/business rules while keeping the same frontend screens.
