-- =============================================================================
-- Hotfix 17.3: lưu nhiều ảnh thật của sản phẩm Shopee để grounding ảnh AI.
-- Chạy trong Supabase SQL Editor. AN TOÀN.
-- =============================================================================

alter table products
  add column if not exists source_product_images jsonb default '[]'::jsonb;
