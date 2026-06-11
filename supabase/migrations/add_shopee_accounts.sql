-- =============================================================================
-- Phase 18: Quản lý nhiều tài khoản Shopee + API riêng từng tài khoản.
-- Chạy trong Supabase SQL Editor. AN TOÀN.
-- =============================================================================

create table if not exists shopee_accounts (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  app_id        text not null,
  app_secret    text not null,
  api_endpoint  text default 'https://open-api.affiliate.shopee.vn/graphql',
  is_default    boolean not null default false,
  status        text not null default 'ACTIVE',
  note          text,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint shopee_accounts_status_check check (status in ('ACTIVE', 'DISABLED'))
);

create index if not exists idx_shopee_accounts_status on shopee_accounts (status);

drop trigger if exists trg_shopee_accounts_updated_at on shopee_accounts;
create trigger trg_shopee_accounts_updated_at
  before update on shopee_accounts
  for each row
  execute function update_updated_at_column();

-- Gắn sản phẩm với tài khoản Shopee đã quét ra nó.
alter table products
  add column if not exists shopee_account_id uuid references shopee_accounts (id) on delete set null;

create index if not exists idx_products_shopee_account on products (shopee_account_id);
