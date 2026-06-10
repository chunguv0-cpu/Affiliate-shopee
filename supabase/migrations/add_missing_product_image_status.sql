-- =============================================================================
-- Hotfix 17.1: chặn album thiếu ảnh thật sản phẩm.
-- Thêm trạng thái MISSING_PRODUCT_IMAGE cho creative_pack_status.
-- Chạy trong Supabase SQL Editor. AN TOÀN, không phá bài cũ.
-- =============================================================================

alter table generated_posts drop constraint if exists generated_posts_creative_pack_status_check;
alter table generated_posts
  add constraint generated_posts_creative_pack_status_check
  check (creative_pack_status in ('PENDING', 'READY', 'PARTIAL', 'FAILED', 'MISSING_PRODUCT_IMAGE'));
