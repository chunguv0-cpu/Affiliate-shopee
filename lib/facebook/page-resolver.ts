import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FacebookPageCredential } from "@/lib/facebook/client";

/**
 * Phase 21 — Resolve Facebook Page credential server-side.
 * Order: generated_post.facebook_page_id -> campaign.facebook_page_id ->
 * default active facebook_pages -> env fallback. NEVER expose/log token.
 */

export type ResolvedPage = {
  facebook_page_id: string | null;
  page_id: string | null;
  page_name: string | null;
  source: "post" | "campaign" | "default" | "env" | "none";
  credential: FacebookPageCredential | null;
};

async function loadPageById(supabase: SupabaseClient, id: string): Promise<{ rowId: string; pageId: string; token: string; pageName: string | null } | null> {
  const { data } = await supabase
    .from("facebook_pages")
    .select("id, page_id, page_name, page_access_token, status")
    .eq("id", id)
    .limit(1)
    .maybeSingle();
  if (!data || data.status !== "ACTIVE") return null;
  const pageId = (data.page_id as string | null)?.trim();
  const token = (data.page_access_token as string | null)?.trim();
  if (!pageId || !token) return null;
  return { rowId: String(data.id), pageId, token, pageName: (data.page_name as string | null) ?? null };
}

async function loadDefaultPage(supabase: SupabaseClient): Promise<{ rowId: string; pageId: string; token: string; pageName: string | null } | null> {
  const { data } = await supabase
    .from("facebook_pages")
    .select("id, page_id, page_name, page_access_token, status, is_default")
    .eq("status", "ACTIVE")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  const pageId = (row.page_id as string | null)?.trim();
  const token = (row.page_access_token as string | null)?.trim();
  if (!pageId || !token) return null;
  return { rowId: String(row.id), pageId, token, pageName: (row.page_name as string | null) ?? null };
}

export async function resolveFacebookPage(
  supabase: SupabaseClient,
  opts: { postPageId?: string | null; campaignPageId?: string | null },
): Promise<ResolvedPage> {
  // 1) Page gắn trực tiếp trên bài.
  if (opts.postPageId) {
    const p = await loadPageById(supabase, opts.postPageId);
    if (p) return { facebook_page_id: p.rowId, page_id: p.pageId, page_name: p.pageName, source: "post", credential: { pageId: p.pageId, accessToken: p.token } };
  }
  // 2) Page của chiến dịch.
  if (opts.campaignPageId) {
    const p = await loadPageById(supabase, opts.campaignPageId);
    if (p) return { facebook_page_id: p.rowId, page_id: p.pageId, page_name: p.pageName, source: "campaign", credential: { pageId: p.pageId, accessToken: p.token } };
  }
  // 3) Page mặc định đang ACTIVE.
  const def = await loadDefaultPage(supabase);
  if (def) return { facebook_page_id: def.rowId, page_id: def.pageId, page_name: def.pageName, source: "default", credential: { pageId: def.pageId, accessToken: def.token } };
  // 4) Env fallback.
  const envPage = process.env.FACEBOOK_PAGE_ID?.trim();
  const envToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (envPage && envToken) {
    return { facebook_page_id: null, page_id: envPage, page_name: null, source: "env", credential: { pageId: envPage, accessToken: envToken } };
  }
  return { facebook_page_id: null, page_id: null, page_name: null, source: "none", credential: null };
}
