-- =============================================================================
-- Phase 20 — Product search relevance + sourcing diagnostics
-- Bổ sung NON-DESTRUCTIVE: chỉ thêm cột, không xóa dữ liệu.
-- Chạy trong Supabase SQL Editor.
-- =============================================================================

-- Nhật ký chẩn đoán sourcing theo từng cơ hội (query, raw/accepted/rejected, lý do).
alter table ai_campaign_runs add column if not exists sourcing_diagnostics jsonb default '[]'::jsonb;
