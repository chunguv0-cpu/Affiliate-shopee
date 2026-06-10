-- =============================================================================
-- Hotfix Phase 13.2: AI Planner error handling + job states
-- Chạy trong Supabase SQL Editor. AN TOÀN, không xóa dữ liệu.
-- =============================================================================

alter table ai_campaign_recommendations add column if not exists error_message text;
alter table ai_campaign_recommendations add column if not exists job_input jsonb;
alter table ai_campaign_recommendations add column if not exists quality_warnings jsonb default '[]'::jsonb;

-- Mở rộng trạng thái: thêm RUNNING, FAILED.
alter table ai_campaign_recommendations drop constraint if exists ai_campaign_recommendations_status_check;
alter table ai_campaign_recommendations
  add constraint ai_campaign_recommendations_status_check
  check (status in ('DRAFT', 'APPROVED', 'REJECTED', 'CONVERTED_TO_CAMPAIGN', 'RUNNING', 'FAILED'));
