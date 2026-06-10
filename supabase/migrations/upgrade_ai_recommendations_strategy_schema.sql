-- =============================================================================
-- Migration: AI Strategic Campaign Brain (Phase 13.2)
-- Thêm các cột chiến lược cho ai_campaign_recommendations. AN TOÀN, không xóa dữ liệu.
-- =============================================================================

alter table ai_campaign_recommendations add column if not exists market_diagnosis        jsonb default '{}'::jsonb;
alter table ai_campaign_recommendations add column if not exists internal_data_diagnosis  jsonb default '{}'::jsonb;
alter table ai_campaign_recommendations add column if not exists goal_strategy            jsonb default '{}'::jsonb;
alter table ai_campaign_recommendations add column if not exists product_decision_table   jsonb default '[]'::jsonb;
alter table ai_campaign_recommendations add column if not exists products_to_source       jsonb default '[]'::jsonb;
alter table ai_campaign_recommendations add column if not exists weekly_execution_plan    jsonb default '[]'::jsonb;
alter table ai_campaign_recommendations add column if not exists engagement_system        jsonb default '{}'::jsonb;
alter table ai_campaign_recommendations add column if not exists creative_brief           jsonb default '{}'::jsonb;
alter table ai_campaign_recommendations add column if not exists measurement_plan         jsonb default '{}'::jsonb;
alter table ai_campaign_recommendations add column if not exists executive_summary        text;
alter table ai_campaign_recommendations add column if not exists next_actions             jsonb default '[]'::jsonb;
alter table ai_campaign_recommendations add column if not exists quality_warnings         jsonb default '[]'::jsonb;
