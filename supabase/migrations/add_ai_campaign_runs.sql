-- =============================================================================
-- Phase 19 — AI Campaign Autopilot
-- Chạy file này trong Supabase SQL Editor.
-- An toàn để chạy lại (idempotent): dùng IF NOT EXISTS / DO blocks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ai_campaign_runs — một "chiến dịch autopilot" do AI gợi ý + chạy theo batch.
-- -----------------------------------------------------------------------------
create table if not exists ai_campaign_runs (
  id                   uuid primary key default gen_random_uuid(),
  title                text,
  objective            text,
  status               text not null default 'DRAFT',
  mode                 text not null default 'WEEKLY',
  start_date           date,
  end_date             date,
  target_customer      text,
  budget_note          text,
  ai_strategy          jsonb default '{}'::jsonb,
  product_opportunities jsonb default '[]'::jsonb,
  -- Trạng thái sourcing/convert/tạo sản phẩm theo từng ứng viên (giữ trong run để idempotent).
  sourced_candidates   jsonb default '[]'::jsonb,
  posting_plan         jsonb default '{}'::jsonb,
  creative_direction   jsonb default '{}'::jsonb,
  approved_at          timestamptz,
  approved_by          text,
  error_message        text,
  current_step         text,
  progress_current     integer not null default 0,
  progress_total       integer not null default 0,
  paused               boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ai_campaign_runs_status_check check (status in (
    'DRAFT','AI_PLANNING','WAITING_APPROVAL','APPROVED',
    'SOURCING_PRODUCTS','CONVERTING_LINKS','CREATING_PRODUCTS',
    'CREATING_POSTS','CREATING_CREATIVES','WAITING_POST_REVIEW',
    'SCHEDULING','SCHEDULED','RUNNING','COMPLETED','FAILED','PAUSED'
  ))
);

create index if not exists idx_ai_campaign_runs_status     on ai_campaign_runs (status);
create index if not exists idx_ai_campaign_runs_created_at  on ai_campaign_runs (created_at desc);

drop trigger if exists trg_ai_campaign_runs_updated_at on ai_campaign_runs;
create trigger trg_ai_campaign_runs_updated_at
  before update on ai_campaign_runs
  for each row
  execute function update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 2) Liên kết campaign run vào các bảng hiện có (nullable, không phá dữ liệu cũ).
-- -----------------------------------------------------------------------------
alter table products        add column if not exists ai_campaign_run_id uuid references ai_campaign_runs (id) on delete set null;
alter table generated_posts add column if not exists ai_campaign_run_id uuid references ai_campaign_runs (id) on delete set null;
alter table ai_jobs         add column if not exists ai_campaign_run_id uuid references ai_campaign_runs (id) on delete set null;

create index if not exists idx_products_campaign_run        on products (ai_campaign_run_id);
create index if not exists idx_generated_posts_campaign_run on generated_posts (ai_campaign_run_id);
create index if not exists idx_ai_jobs_campaign_run         on ai_jobs (ai_campaign_run_id);

-- -----------------------------------------------------------------------------
-- 3) generated_posts — hàng đợi duyệt bài (review) + lịch tự động.
-- -----------------------------------------------------------------------------
alter table generated_posts add column if not exists review_status     text default 'PENDING_REVIEW';
alter table generated_posts add column if not exists automation_status text;
alter table generated_posts add column if not exists auto_scheduled    boolean not null default false;
alter table generated_posts add column if not exists review_approved_at timestamptz;
alter table generated_posts add column if not exists review_approved_by text;

-- Ràng buộc giá trị review_status (cho phép NULL để tương thích bản ghi cũ).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'generated_posts_review_status_check'
  ) then
    alter table generated_posts add constraint generated_posts_review_status_check
      check (review_status is null or review_status in ('PENDING_REVIEW','APPROVED','REJECTED','NEEDS_EDIT'));
  end if;
end $$;

-- Backfill: bài đã READY/PUBLISHED trước đây vẫn đăng được (coi như đã duyệt).
-- Bài mới (autopilot) sẽ mặc định PENDING_REVIEW và do người dùng duyệt thủ công.
update generated_posts
  set review_status = 'APPROVED'
  where review_status is distinct from 'APPROVED'
    and status in ('READY','PUBLISHED');

create index if not exists idx_generated_posts_review_status on generated_posts (review_status);

-- -----------------------------------------------------------------------------
-- 4) sourcing_candidates — thêm liên kết campaign run + cho phép trạng thái mới.
-- -----------------------------------------------------------------------------
alter table sourcing_candidates add column if not exists ai_campaign_run_id uuid references ai_campaign_runs (id) on delete set null;
create index if not exists idx_sourcing_campaign_run on sourcing_candidates (ai_campaign_run_id);
