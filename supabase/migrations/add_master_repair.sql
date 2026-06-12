-- =============================================================================
-- Phase 21 — MASTER REPAIR: multi Facebook Page, per-campaign Shopee account +
-- Facebook page selection, universal keyword-lock fields.
-- NON-DESTRUCTIVE: only adds tables/columns + widens checks. No data deleted.
-- Run in Supabase SQL Editor.
-- =============================================================================

create extension if not exists "pgcrypto";

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 1) facebook_pages — nhiều Page Facebook, token lưu server-side.
-- -----------------------------------------------------------------------------
create table if not exists facebook_pages (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  page_id                  text not null,
  page_name                text,
  page_access_token        text not null,
  token_expires_at         timestamptz,
  status                   text not null default 'ACTIVE',
  is_default               boolean not null default false,
  notes                    text,
  last_publish_test_at     timestamptz,
  last_publish_test_result jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint facebook_pages_status_check check (status in ('ACTIVE','DISABLED','EXPIRED','ERROR'))
);
create index if not exists idx_facebook_pages_status on facebook_pages (status);
create index if not exists idx_facebook_pages_default on facebook_pages (is_default);
drop trigger if exists trg_facebook_pages_updated_at on facebook_pages;
create trigger trg_facebook_pages_updated_at
  before update on facebook_pages
  for each row execute function update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 2) shopee_accounts — bổ sung superset (giữ app_id/app_secret/api_endpoint cũ).
-- -----------------------------------------------------------------------------
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

alter table shopee_accounts add column if not exists name text;
alter table shopee_accounts add column if not exists account_label text;
alter table shopee_accounts add column if not exists provider text default 'shopee_api';
alter table shopee_accounts add column if not exists shop_id text;
alter table shopee_accounts add column if not exists partner_id text;
alter table shopee_accounts add column if not exists api_base_url text;
alter table shopee_accounts add column if not exists access_token text;
alter table shopee_accounts add column if not exists refresh_token text;
alter table shopee_accounts add column if not exists token_expires_at timestamptz;
alter table shopee_accounts add column if not exists last_test_at timestamptz;
alter table shopee_accounts add column if not exists last_test_result jsonb;

-- Widen status check to ACTIVE/DISABLED/EXPIRED/ERROR.
alter table shopee_accounts drop constraint if exists shopee_accounts_status_check;
alter table shopee_accounts
  add constraint shopee_accounts_status_check
  check (status in ('ACTIVE','DISABLED','EXPIRED','ERROR'));

-- -----------------------------------------------------------------------------
-- 3) ai_campaign_runs — account/page selection + keyword-lock fields.
-- -----------------------------------------------------------------------------
alter table ai_campaign_runs add column if not exists shopee_account_id uuid references shopee_accounts (id) on delete set null;
alter table ai_campaign_runs add column if not exists facebook_page_id uuid references facebook_pages (id) on delete set null;
alter table ai_campaign_runs add column if not exists user_keyword text;
alter table ai_campaign_runs add column if not exists user_objective text;
alter table ai_campaign_runs add column if not exists user_category_hint text;
alter table ai_campaign_runs add column if not exists locked_vertical text;
alter table ai_campaign_runs add column if not exists vertical_confidence numeric;
alter table ai_campaign_runs add column if not exists keyword_lock_enabled boolean not null default true;
alter table ai_campaign_runs add column if not exists allowed_terms jsonb default '[]'::jsonb;
alter table ai_campaign_runs add column if not exists negative_terms jsonb default '[]'::jsonb;
alter table ai_campaign_runs add column if not exists allowed_categories jsonb default '[]'::jsonb;
alter table ai_campaign_runs add column if not exists blocked_categories jsonb default '[]'::jsonb;
alter table ai_campaign_runs add column if not exists suggested_specific_queries jsonb default '[]'::jsonb;
alter table ai_campaign_runs add column if not exists needs_clarification boolean not null default false;
alter table ai_campaign_runs add column if not exists clarification_question text;

create index if not exists idx_ai_campaign_runs_shopee_account on ai_campaign_runs (shopee_account_id);
create index if not exists idx_ai_campaign_runs_facebook_page on ai_campaign_runs (facebook_page_id);

-- -----------------------------------------------------------------------------
-- 4) generated_posts — lưu Page/Shopee account đã chọn.
-- -----------------------------------------------------------------------------
alter table generated_posts add column if not exists facebook_page_id uuid references facebook_pages (id) on delete set null;
alter table generated_posts add column if not exists shopee_account_id uuid references shopee_accounts (id) on delete set null;
alter table generated_posts add column if not exists approved_at timestamptz;
create index if not exists idx_generated_posts_facebook_page on generated_posts (facebook_page_id);

-- -----------------------------------------------------------------------------
-- 5) ai_jobs — mang facebook_page_id để bài tạo ra gắn đúng Page.
-- -----------------------------------------------------------------------------
alter table ai_jobs add column if not exists facebook_page_id uuid references facebook_pages (id) on delete set null;
