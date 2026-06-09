-- =============================================================================
-- Shopee Affiliate Auto Agent — Database Schema (Phase 1)
-- Chạy file này trong Supabase SQL Editor.
-- =============================================================================

-- Extension cần cho gen_random_uuid()
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Function: tự động cập nhật cột updated_at mỗi khi UPDATE
-- -----------------------------------------------------------------------------
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- 1) products
-- =============================================================================
create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  product_name    text not null,
  affiliate_link  text not null,
  price_note      text,
  target_customer text,
  product_angle   text,
  image_url       text,
  status          text not null default 'NEW',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint products_status_check
    check (status in ('NEW', 'ACTIVE', 'PAUSED', 'ARCHIVED'))
);

create index if not exists idx_products_status     on products (status);
create index if not exists idx_products_created_at  on products (created_at desc);

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- 2) generated_posts
-- =============================================================================
create table if not exists generated_posts (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid references products (id) on delete cascade,
  caption           text,
  hook              text,
  ai_score          int,
  safety_notes      text,
  should_publish    boolean not null default false,
  scheduled_at      timestamptz,
  status            text not null default 'DRAFT',
  facebook_post_id  text,
  facebook_post_url text,
  published_at      timestamptz,
  error_log         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint generated_posts_status_check
    check (status in ('DRAFT', 'READY', 'REJECTED', 'PUBLISHED', 'FAILED', 'SKIPPED', 'PUBLISHING'))
);

create index if not exists idx_generated_posts_product_id   on generated_posts (product_id);
create index if not exists idx_generated_posts_status       on generated_posts (status);
create index if not exists idx_generated_posts_scheduled_at on generated_posts (scheduled_at);
create index if not exists idx_generated_posts_created_at   on generated_posts (created_at desc);

drop trigger if exists trg_generated_posts_updated_at on generated_posts;
create trigger trg_generated_posts_updated_at
  before update on generated_posts
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- 3) posting_logs
-- =============================================================================
create table if not exists posting_logs (
  id                uuid primary key default gen_random_uuid(),
  generated_post_id uuid references generated_posts (id) on delete cascade,
  action            text,
  status            text,
  message           text,
  raw_response      jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_posting_logs_generated_post_id on posting_logs (generated_post_id);
create index if not exists idx_posting_logs_created_at        on posting_logs (created_at desc);

-- Lưu ý: posting_logs là bảng append-only (chỉ ghi log), nên KHÔNG cần updated_at/trigger.

-- =============================================================================
-- 4) app_settings
-- =============================================================================
create table if not exists app_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_settings_key on app_settings (key);

drop trigger if exists trg_app_settings_updated_at on app_settings;
create trigger trg_app_settings_updated_at
  before update on app_settings
  for each row
  execute function update_updated_at_column();
