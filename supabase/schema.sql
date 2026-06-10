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
  original_url    text,
  affiliate_link  text,
  sub_id          text,
  link_status     text not null default 'NEED_CONVERT',
  link_note       text,
  price_note      text,
  target_customer text,
  product_angle   text,
  image_url       text,
  status          text not null default 'NEW',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint products_status_check
    check (status in ('NEW', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  constraint products_link_status_check
    check (link_status in ('NEED_CONVERT', 'READY', 'INVALID'))
);

create index if not exists idx_products_status      on products (status);
create index if not exists idx_products_link_status  on products (link_status);
create index if not exists idx_products_created_at   on products (created_at desc);

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- 1b) campaigns (Phase 10) — đặt trước generated_posts vì có FK tham chiếu.
-- =============================================================================
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'DRAFT',
  start_at    timestamptz,
  end_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campaigns_status_check
    check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'PAUSED'))
);

create index if not exists idx_campaigns_status    on campaigns (status);
create index if not exists idx_campaigns_created_at on campaigns (created_at desc);

drop trigger if exists trg_campaigns_updated_at on campaigns;
create trigger trg_campaigns_updated_at
  before update on campaigns
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- 2) generated_posts
-- =============================================================================
create table if not exists generated_posts (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid references products (id) on delete cascade,
  campaign_id       uuid references campaigns (id) on delete set null,
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
  content_angle_variant text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint generated_posts_status_check
    check (status in ('DRAFT', 'READY', 'REJECTED', 'PUBLISHED', 'FAILED', 'SKIPPED', 'PUBLISHING'))
);

create index if not exists idx_generated_posts_product_id   on generated_posts (product_id);
create index if not exists idx_generated_posts_campaign_id  on generated_posts (campaign_id);
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

-- =============================================================================
-- 5) affiliate_reports (Phase 12) — báo cáo hiệu quả nhập thủ công từ Shopee.
-- =============================================================================
create table if not exists affiliate_reports (
  id             uuid primary key default gen_random_uuid(),
  report_date    date,
  sub_id         text,
  affiliate_link text,
  product_name   text,
  clicks         int default 0,
  orders         int default 0,
  commission     numeric default 0,
  revenue        numeric default 0,
  status         text,
  raw_row        jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_affiliate_reports_sub_id        on affiliate_reports (sub_id);
create index if not exists idx_affiliate_reports_affiliate_link on affiliate_reports (affiliate_link);
create index if not exists idx_affiliate_reports_report_date    on affiliate_reports (report_date);
create index if not exists idx_affiliate_reports_created_at      on affiliate_reports (created_at desc);

-- =============================================================================
-- 6) ai_campaign_recommendations (Phase 13) — gợi ý chiến dịch tuần do AI tạo.
-- =============================================================================
create table if not exists ai_campaign_recommendations (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  goal                  text,
  week_start            date,
  week_end              date,
  status                text not null default 'DRAFT',
  summary               text,
  strategy              text,
  recommended_products  jsonb default '[]'::jsonb,
  recommended_schedule  jsonb default '[]'::jsonb,
  content_angles        jsonb default '[]'::jsonb,
  engagement_hooks      jsonb default '[]'::jsonb,
  risks                 jsonb default '[]'::jsonb,
  ai_reasoning_summary  text,
  raw_ai_response       jsonb,
  -- Phase 13.1
  research_run_id       uuid,
  campaign_concept      jsonb,
  interaction_plan      jsonb default '[]'::jsonb,
  creative_directions   jsonb default '[]'::jsonb,
  suggested_new_products jsonb default '[]'::jsonb,
  market_research       jsonb,
  -- Phase 13.2 (AI Strategic Campaign Brain)
  executive_summary        text,
  market_diagnosis         jsonb default '{}'::jsonb,
  internal_data_diagnosis  jsonb default '{}'::jsonb,
  goal_strategy            jsonb default '{}'::jsonb,
  product_decision_table   jsonb default '[]'::jsonb,
  products_to_source       jsonb default '[]'::jsonb,
  weekly_execution_plan    jsonb default '[]'::jsonb,
  engagement_system        jsonb default '{}'::jsonb,
  creative_brief           jsonb default '{}'::jsonb,
  measurement_plan         jsonb default '{}'::jsonb,
  next_actions             jsonb default '[]'::jsonb,
  quality_warnings         jsonb default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ai_campaign_recommendations_status_check
    check (status in ('DRAFT', 'APPROVED', 'REJECTED', 'CONVERTED_TO_CAMPAIGN'))
);

create index if not exists idx_ai_recs_status     on ai_campaign_recommendations (status);
create index if not exists idx_ai_recs_created_at  on ai_campaign_recommendations (created_at desc);

drop trigger if exists trg_ai_recs_updated_at on ai_campaign_recommendations;
create trigger trg_ai_recs_updated_at
  before update on ai_campaign_recommendations
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- 7) market_research_runs / market_research_sources (Phase 13.1)
-- =============================================================================
create table if not exists market_research_runs (
  id              uuid primary key default gen_random_uuid(),
  goal            text,
  target_customer text,
  week_start      date,
  week_end        date,
  status          text not null default 'PENDING',
  provider        text,
  queries         jsonb default '[]'::jsonb,
  summary         text,
  insights        jsonb default '[]'::jsonb,
  raw_response    jsonb,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint market_research_runs_status_check
    check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED'))
);

create index if not exists idx_mrr_created_at on market_research_runs (created_at desc);
create index if not exists idx_mrr_status     on market_research_runs (status);

drop trigger if exists trg_mrr_updated_at on market_research_runs;
create trigger trg_mrr_updated_at
  before update on market_research_runs
  for each row
  execute function update_updated_at_column();

create table if not exists market_research_sources (
  id               uuid primary key default gen_random_uuid(),
  research_run_id  uuid references market_research_runs (id) on delete cascade,
  query            text,
  title            text,
  url              text,
  snippet          text,
  content          text,
  source_type      text,
  relevance_score  numeric,
  created_at       timestamptz not null default now()
);

create index if not exists idx_mrs_run_id on market_research_sources (research_run_id);
create index if not exists idx_mrs_query  on market_research_sources (query);
