import "server-only";

import { isShopeeAffiliateLink, slugify } from "@/lib/affiliate";
import { resolveShopeeAccount } from "@/lib/shopee/account-resolver";
import { generateAffiliateShortLink, type ShopeeApiCredential } from "@/lib/shopee/affiliate-api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Phase 19 — Affiliate Link Converter cho Autopilot.
 * KHÔNG bịa link. KHÔNG dùng URL sản phẩm thô làm link affiliate.
 * Ưu tiên offerLink có sẵn từ bước sourcing (Shopee API trả kèm).
 */

export type AffiliateLinkProvider = "none" | "shopee_api" | "custom_api";

export function getAffiliateLinkProvider(): AffiliateLinkProvider {
  const raw = process.env.SHOPEE_AFFILIATE_LINK_PROVIDER?.trim().toLowerCase();
  if (raw === "shopee_api" || raw === "custom_api" || raw === "none") return raw;
  return "shopee_api";
}

export type ConvertLinkInput = {
  product_url: string | null;
  /** offerLink đã có từ bước sourcing (nếu có) — ưu tiên dùng. */
  existing_offer_link?: string | null;
  campaign_slug: string;
  index: number;
  sub_id?: string | null;
  source?: string | null;
  /** Phase 21 — tài khoản Shopee của chiến dịch. */
  shopeeAccountId?: string | null;
};

export type ConvertLinkResult = {
  ok: boolean;
  configured: boolean;
  affiliate_link: string | null;
  sub_id: string | null;
  original_url: string | null;
  error: string | null;
};

/** Sinh sub_id ổn định (deterministic): camp_<slug>_<NNN>. */
export function buildCampaignSubId(campaignSlug: string, index: number): string {
  const slug = slugify(campaignSlug || "camp");
  const seq = String(Math.max(1, index)).padStart(3, "0");
  return `camp_${slug}_${seq}`.slice(0, 60);
}

async function getDefaultShopeeCredential(): Promise<ShopeeApiCredential | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("shopee_accounts")
      .select("app_id, app_secret, api_endpoint, status, is_default")
      .eq("status", "ACTIVE")
      .order("is_default", { ascending: false })
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const row = data?.[0];
    if (!row) return null;
    return {
      app_id: row.app_id as string,
      app_secret: row.app_secret as string,
      api_endpoint: (row.api_endpoint as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Chuyển product_url -> affiliate_link. KHÔNG throw. */
export async function convertProductUrlToAffiliateLink(input: ConvertLinkInput): Promise<ConvertLinkResult> {
  const provider = getAffiliateLinkProvider();
  const subId = (input.sub_id ?? "").trim() || buildCampaignSubId(input.campaign_slug, input.index);
  const originalUrl = (input.product_url ?? "").trim() || null;
  const offer = (input.existing_offer_link ?? "").trim();

  // Trường hợp tốt nhất: bước sourcing đã trả về offerLink hợp lệ.
  if (offer && isShopeeAffiliateLink(offer)) {
    return { ok: true, configured: true, affiliate_link: offer, sub_id: subId, original_url: originalUrl, error: null };
  }

  if (provider === "none") {
    return { ok: false, configured: false, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: "Chưa cấu hình SHOPEE_AFFILIATE_LINK_PROVIDER." };
  }

  if (!originalUrl) {
    return { ok: false, configured: true, affiliate_link: null, sub_id: subId, original_url: null, error: "Thiếu URL sản phẩm để chuyển link." };
  }

  if (provider === "shopee_api") {
    const supabase = createSupabaseAdminClient();
    const resolved = await resolveShopeeAccount(supabase, input.shopeeAccountId ?? null);
    const cred = resolved.credential ?? (await getDefaultShopeeCredential());
    if (!cred) {
      return { ok: false, configured: false, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: "Chưa có tài khoản Shopee ACTIVE để chuyển link." };
    }
    const res = await generateAffiliateShortLink(cred, { originUrl: originalUrl, subIds: [subId] });
    if (!res.ok || !res.shortLink) {
      return { ok: false, configured: true, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: res.error ?? "Chuyển link thất bại." };
    }
    return { ok: true, configured: true, affiliate_link: res.shortLink, sub_id: subId, original_url: originalUrl, error: null };
  }

  // custom_api
  const baseURL = process.env.PRODUCT_DATA_API_BASE_URL?.trim();
  const apiKey = process.env.PRODUCT_DATA_API_KEY?.trim();
  if (!baseURL) {
    return { ok: false, configured: false, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: "Chưa cấu hình PRODUCT_DATA_API_BASE_URL cho custom_api." };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/affiliate-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ product_url: originalUrl, sub_id: subId }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { ok: false, configured: true, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: `custom_api HTTP ${res.status}` };
    const json = (await res.json()) as { affiliate_link?: string };
    const link = typeof json.affiliate_link === "string" ? json.affiliate_link.trim() : "";
    if (!link || !/^https?:\/\//i.test(link)) {
      return { ok: false, configured: true, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: "custom_api không trả về affiliate_link hợp lệ." };
    }
    return { ok: true, configured: true, affiliate_link: link, sub_id: subId, original_url: originalUrl, error: null };
  } catch (err) {
    const m = err instanceof Error ? (err.name === "AbortError" ? "custom_api quá thời gian." : err.message) : "custom_api lỗi.";
    return { ok: false, configured: true, affiliate_link: null, sub_id: subId, original_url: originalUrl, error: m.slice(0, 200) };
  }
}
