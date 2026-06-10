-- =============================================================================
-- Migration: thêm gợi ý "sản phẩm nên tìm thêm" cho AI plan (Phase 13.1+)
-- Chạy trong Supabase SQL Editor. AN TOÀN.
-- =============================================================================

alter table ai_campaign_recommendations
  add column if not exists suggested_new_products jsonb default '[]'::jsonb;
