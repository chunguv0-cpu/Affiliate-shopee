-- =============================================================================
-- Phase 17: Visual Creative Automation V1 — thêm trường creative cho bài đăng.
-- Chạy trong Supabase SQL Editor. AN TOÀN, không phá bài cũ.
-- =============================================================================

alter table generated_posts add column if not exists creative_type text default 'TEXT_ONLY';
alter table generated_posts add column if not exists creative_image_url text;
alter table generated_posts add column if not exists creative_hook text;
alter table generated_posts add column if not exists creative_brief text;
alter table generated_posts add column if not exists creative_status text default 'PENDING';
alter table generated_posts add column if not exists facebook_publish_type text default 'FEED';

-- Ràng buộc giá trị (drop trước nếu chạy lại).
alter table generated_posts drop constraint if exists generated_posts_creative_type_check;
alter table generated_posts
  add constraint generated_posts_creative_type_check
  check (creative_type in ('TEXT_ONLY', 'IMAGE', 'VIDEO'));

alter table generated_posts drop constraint if exists generated_posts_creative_status_check;
alter table generated_posts
  add constraint generated_posts_creative_status_check
  check (creative_status in ('PENDING', 'READY', 'MISSING_ASSET', 'FAILED'));

alter table generated_posts drop constraint if exists generated_posts_fb_publish_type_check;
alter table generated_posts
  add constraint generated_posts_fb_publish_type_check
  check (facebook_publish_type in ('FEED', 'PHOTO', 'VIDEO'));
