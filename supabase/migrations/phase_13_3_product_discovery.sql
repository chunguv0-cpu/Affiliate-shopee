-- =============================================================================
-- Phase 13.3: Product Discovery Mode
-- Chạy trong Supabase SQL Editor. AN TOÀN, không xóa dữ liệu.
-- =============================================================================

alter table ai_campaign_recommendations
  add column if not exists planner_mode text default 'HYBRID';

alter table ai_campaign_recommendations
  add column if not exists product_discovery_strategy jsonb default '{}'::jsonb;

-- Ràng buộc giá trị planner_mode (xóa cũ nếu có rồi thêm lại).
alter table ai_campaign_recommendations
  drop constraint if exists ai_campaign_recommendations_planner_mode_check;
alter table ai_campaign_recommendations
  add constraint ai_campaign_recommendations_planner_mode_check
  check (planner_mode in ('HYBRID', 'EXISTING_ONLY', 'DISCOVERY_ONLY'));
