-- =============================================================================
-- Phase 15: liên kết AI recommendation -> campaign thật.
-- Chạy trong Supabase SQL Editor. AN TOÀN, không xóa dữ liệu.
-- =============================================================================

alter table ai_campaign_recommendations
  add column if not exists campaign_id uuid references campaigns (id) on delete set null;

create index if not exists idx_ai_recs_campaign_id on ai_campaign_recommendations (campaign_id);
