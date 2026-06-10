-- =============================================================================
-- Migration: thêm cột content_angle_variant cho generated_posts (Phase 10.1)
-- Chạy trong Supabase SQL Editor. AN TOÀN: không xóa dữ liệu.
-- =============================================================================

alter table generated_posts
  add column if not exists content_angle_variant text;
