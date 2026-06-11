import "server-only";

import { searchProductOffers, type ShopeeApiCredential } from "@/lib/shopee/affiliate-api";
import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Phase 19 — Product Sourcing Provider cho Autopilot.
 * Bọc Shopee Affiliate Open API (productOfferV2) — trả về cả offerLink (link affiliate).
 * KHÔNG fake kết quả. Nếu provider chưa cấu hình -> configured=false để đẩy sang Tìm link thủ công.
 */

export type ProductSearchProvider = "none" | "shopee_api" | "custom_api";

export function getProductSearchProvider(): ProductSearchProvider {
  const raw = process.env.SHOPEE_PRODUCT_SEARCH_PROVIDER?.trim().toLowerCase();
  if (raw === "shopee_api" || raw === "custom_api" || raw === "none") return raw;
  // Mặc định shopee_api (đã có sẵn client + tài khoản Shopee trong app).
  return "shopee_api";
}

export type SourcingSearchInput = {
  product_keyword: string;
  category?: string | null;
  target_customer?: string | null;
  suggested_price_range?: string | null;
  search_keywords?: string[];
  reason?: string | null;
  limit?: number;
};

export type SourcingSearchItem = {
  product_name: string;
  product_url: string | null;
  item_id: string | null;
  shop_id: string | null;
  shop_name: string | null;
  image_urls: string[];
  price_note: string | null;
  rating_note: string | null;
  sold_note: string | null;
  category: string | null;
  reason: string | null;
  /** offerLink — link affiliate của tài khoản (nếu provider trả về). */
  affiliate_link: string | null;
};

export type SourcingSearchResult = {
  ok: boolean;
  configured: boolean;
  provider: ProductSearchProvider;
  results: SourcingSearchItem[];
  error: string | null;
};

/** Đọc credential tài khoản Shopee mặc định/đang ACTIVE (server-only). */
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

function cleanImages(url: string | null | undefined): string[] {
  if (!url) return [];
  const normalized = normalizeImageUrl(url);
  return isLikelyProductImage(normalized) ? [normalized] : normalized && /^https?:\/\//i.test(normalized) ? [normalized] : [];
}

/** Tìm sản phẩm Shopee cho 1 cơ hội của chiến dịch. KHÔNG throw. */
export async function searchShopeeProductsForCampaign(input: SourcingSearchInput): Promise<SourcingSearchResult> {
  const provider = getProductSearchProvider();
  const limit = Math.max(1, Math.min(20, input.limit ?? 8));
  const keyword = (input.product_keyword ?? "").trim();
  if (!keyword) {
    return { ok: false, configured: true, provider, results: [], error: "Thiếu từ khóa sản phẩm." };
  }

  if (provider === "none") {
    return { ok: false, configured: false, provider, results: [], error: "Chưa cấu hình SHOPEE_PRODUCT_SEARCH_PROVIDER." };
  }

  if (provider === "shopee_api") {
    const cred = await getDefaultShopeeCredential();
    if (!cred) {
      return {
        ok: false,
        configured: false,
        provider,
        results: [],
        error: "Chưa có tài khoản Shopee ACTIVE. Thêm tài khoản ở mục 'Tài khoản Shopee'.",
      };
    }
    // Thử lần lượt các từ khóa tìm kiếm cho tới khi có kết quả.
    const keywords = [keyword, ...(input.search_keywords ?? [])].map((k) => k.trim()).filter(Boolean);
    const seen = new Set<string>();
    const dedupKeywords = keywords.filter((k) => (seen.has(k.toLowerCase()) ? false : (seen.add(k.toLowerCase()), true)));
    let lastError: string | null = null;
    for (const kw of dedupKeywords) {
      const res = await searchProductOffers(cred, { keyword: kw, limit });
      if (!res.ok) {
        lastError = res.error ?? "Tìm sản phẩm thất bại.";
        continue;
      }
      const results: SourcingSearchItem[] = res.offers
        .filter((o) => o.productName)
        .map((o) => ({
          product_name: o.productName as string,
          product_url: o.productLink,
          item_id: o.itemId,
          shop_id: o.shopId,
          shop_name: null,
          image_urls: cleanImages(o.imageUrl),
          price_note: o.priceMin ? `Từ ${o.priceMin}` : null,
          rating_note: null,
          sold_note: null,
          category: input.category ?? null,
          reason: input.reason ?? null,
          affiliate_link: o.offerLink,
        }));
      if (results.length > 0) {
        return { ok: true, configured: true, provider, results, error: null };
      }
    }
    return { ok: false, configured: true, provider, results: [], error: lastError ?? "Không tìm thấy sản phẩm phù hợp." };
  }

  // custom_api
  const baseURL = process.env.PRODUCT_DATA_API_BASE_URL?.trim();
  const apiKey = process.env.PRODUCT_DATA_API_KEY?.trim();
  if (!baseURL) {
    return { ok: false, configured: false, provider, results: [], error: "Chưa cấu hình PRODUCT_DATA_API_BASE_URL cho custom_api." };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/product-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ keyword, search_keywords: input.search_keywords ?? [], country: process.env.PRODUCT_DATA_COUNTRY?.trim() || "VN", limit }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { ok: false, configured: true, provider, results: [], error: `custom_api HTTP ${res.status}` };
    const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
    const items = Array.isArray(json.items) ? json.items : [];
    const results: SourcingSearchItem[] = items
      .map((it) => {
        const name = typeof it.product_name === "string" ? it.product_name : "";
        if (!name) return null;
        const imgs = Array.isArray(it.image_urls)
          ? (it.image_urls as unknown[]).filter((x): x is string => typeof x === "string").map(normalizeImageUrl).filter((u) => /^https?:\/\//i.test(u))
          : [];
        return {
          product_name: name,
          product_url: typeof it.product_url === "string" ? it.product_url : null,
          item_id: typeof it.item_id === "string" ? it.item_id : null,
          shop_id: typeof it.shop_id === "string" ? it.shop_id : null,
          shop_name: typeof it.shop_name === "string" ? it.shop_name : null,
          image_urls: imgs,
          price_note: typeof it.price_note === "string" ? it.price_note : null,
          rating_note: typeof it.rating_note === "string" ? it.rating_note : null,
          sold_note: typeof it.sold_note === "string" ? it.sold_note : null,
          category: input.category ?? (typeof it.category === "string" ? it.category : null),
          reason: input.reason ?? null,
          affiliate_link: typeof it.affiliate_link === "string" ? it.affiliate_link : null,
        } satisfies SourcingSearchItem;
      })
      .filter((x): x is SourcingSearchItem => x !== null);
    return { ok: results.length > 0, configured: true, provider, results, error: results.length > 0 ? null : "custom_api không trả về sản phẩm." };
  } catch (err) {
    const m = err instanceof Error ? (err.name === "AbortError" ? "custom_api quá thời gian." : err.message) : "custom_api lỗi.";
    return { ok: false, configured: true, provider, results: [], error: m.slice(0, 200) };
  }
}

/** Chấm điểm 1 ứng viên để chọn cái tốt nhất cho một cơ hội. */
export function scoreSearchItem(item: SourcingSearchItem): number {
  let score = 40;
  if (item.image_urls.length > 0) score += 25;
  if (item.affiliate_link) score += 20;
  if (item.product_url) score += 8;
  if (item.price_note) score += 4;
  if (item.item_id) score += 3;
  return Math.min(100, score);
}
