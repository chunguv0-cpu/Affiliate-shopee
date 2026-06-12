import "server-only";

import { resolveShopeeAccount } from "@/lib/shopee/account-resolver";
import { searchProductOffers, type ShopeeApiCredential } from "@/lib/shopee/affiliate-api";
import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Phase 19/20 — Product Sourcing Provider cho Autopilot.
 * Bọc Shopee Affiliate Open API (productOfferV2) — trả về cả offerLink (link affiliate).
 * KHÔNG fake kết quả. Trả raw results để tầng relevance lọc nghiêm ngặt.
 */

export type ProductSearchProvider = "none" | "shopee_api" | "custom_api";

export function getProductSearchProvider(): ProductSearchProvider {
  const raw = process.env.SHOPEE_PRODUCT_SEARCH_PROVIDER?.trim().toLowerCase();
  if (raw === "shopee_api" || raw === "custom_api" || raw === "none") return raw;
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
  if (!normalized || !/^https?:\/\//i.test(normalized)) return [];
  return isLikelyProductImage(normalized) ? [normalized] : [normalized];
}

function itemKey(it: { item_id: string | null; product_url: string | null; affiliate_link: string | null; product_name: string }): string {
  return (
    (it.item_id && `item:${it.item_id}`) ||
    (it.product_url && `url:${it.product_url}`) ||
    (it.affiliate_link && `aff:${it.affiliate_link}`) ||
    `name:${it.product_name.toLowerCase()}`
  );
}

/** Tìm raw items cho 1 keyword (shopee_api). KHÔNG lọc relevance. */
async function shopeeSearchOne(cred: ShopeeApiCredential, keyword: string, limit: number, category: string | null): Promise<{ ok: boolean; items: SourcingSearchItem[]; error: string | null }> {
  const res = await searchProductOffers(cred, { keyword, limit });
  if (!res.ok) return { ok: false, items: [], error: res.error ?? "Tìm sản phẩm thất bại." };
  const items: SourcingSearchItem[] = res.offers
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
      category,
      reason: null,
      affiliate_link: o.offerLink,
    }));
  return { ok: true, items, error: null };
}

async function customApiSearchOne(keyword: string, limit: number, category: string | null): Promise<{ ok: boolean; items: SourcingSearchItem[]; error: string | null }> {
  const baseURL = process.env.PRODUCT_DATA_API_BASE_URL?.trim();
  const apiKey = process.env.PRODUCT_DATA_API_KEY?.trim();
  if (!baseURL) return { ok: false, items: [], error: "Chưa cấu hình PRODUCT_DATA_API_BASE_URL cho custom_api." };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/product-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ keyword, country: process.env.PRODUCT_DATA_COUNTRY?.trim() || "VN", limit }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { ok: false, items: [], error: `custom_api HTTP ${res.status}` };
    const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
    const raw = Array.isArray(json.items) ? json.items : [];
    const items: SourcingSearchItem[] = [];
    for (const it of raw) {
      const name = typeof it.product_name === "string" ? it.product_name : "";
      if (!name) continue;
      const imgs = Array.isArray(it.image_urls)
        ? (it.image_urls as unknown[]).filter((x): x is string => typeof x === "string").map(normalizeImageUrl).filter((u) => /^https?:\/\//i.test(u))
        : [];
      items.push({
        product_name: name,
        product_url: typeof it.product_url === "string" ? it.product_url : null,
        item_id: typeof it.item_id === "string" ? it.item_id : null,
        shop_id: typeof it.shop_id === "string" ? it.shop_id : null,
        shop_name: typeof it.shop_name === "string" ? it.shop_name : null,
        image_urls: imgs,
        price_note: typeof it.price_note === "string" ? it.price_note : null,
        rating_note: typeof it.rating_note === "string" ? it.rating_note : null,
        sold_note: typeof it.sold_note === "string" ? it.sold_note : null,
        category: category ?? (typeof it.category === "string" ? it.category : null),
        reason: null,
        affiliate_link: typeof it.affiliate_link === "string" ? it.affiliate_link : null,
      });
    }
    return { ok: true, items, error: null };
  } catch (err) {
    const m = err instanceof Error ? (err.name === "AbortError" ? "custom_api quá thời gian." : err.message) : "custom_api lỗi.";
    return { ok: false, items: [], error: m.slice(0, 200) };
  }
}

/**
 * Tìm RAW products theo nhiều query (đã được mở rộng cụ thể), gộp + dedupe.
 * KHÔNG lọc relevance ở đây — để tầng relevance quyết định chấp nhận.
 */
export async function searchRawProducts(
  queries: string[],
  opts: { limit?: number; category?: string | null; maxResults?: number; shopeeAccountId?: string | null } = {},
): Promise<SourcingSearchResult> {
  const provider = getProductSearchProvider();
  const limit = Math.max(1, Math.min(20, opts.limit ?? 10));
  const maxResults = Math.max(1, Math.min(60, opts.maxResults ?? 30));
  const category = opts.category ?? null;
  const cleanQueries = Array.from(new Set(queries.map((q) => (q ?? "").trim()).filter(Boolean)));
  if (cleanQueries.length === 0) {
    return { ok: false, configured: true, provider, results: [], error: "Thiếu query tìm kiếm." };
  }

  if (provider === "none") {
    return { ok: false, configured: false, provider, results: [], error: "Chưa cấu hình SHOPEE_PRODUCT_SEARCH_PROVIDER." };
  }

  let cred: ShopeeApiCredential | null = null;
  if (provider === "shopee_api") {
    // Phase 21: ưu tiên tài khoản chiến dịch chọn, fallback mặc định.
    const supabase = createSupabaseAdminClient();
    const resolved = await resolveShopeeAccount(supabase, opts.shopeeAccountId ?? null);
    cred = resolved.credential ?? (await getDefaultShopeeCredential());
    if (!cred) {
      return {
        ok: false,
        configured: false,
        provider,
        results: [],
        error: "Chưa có tài khoản Shopee ACTIVE. Thêm tài khoản ở mục 'Tài khoản & Page'.",
      };
    }
  }

  const seen = new Set<string>();
  const results: SourcingSearchItem[] = [];
  let lastError: string | null = null;
  for (const q of cleanQueries) {
    if (results.length >= maxResults) break;
    const r = provider === "shopee_api" ? await shopeeSearchOne(cred as ShopeeApiCredential, q, limit, category) : await customApiSearchOne(q, limit, category);
    if (!r.ok) {
      lastError = r.error;
      continue;
    }
    for (const item of r.items) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
      if (results.length >= maxResults) break;
    }
  }

  return { ok: results.length > 0, configured: true, provider, results, error: results.length > 0 ? null : lastError ?? "Không tìm thấy sản phẩm." };
}

/** Back-compat: tìm theo product_keyword + search_keywords, trả raw items. */
export async function searchShopeeProductsForCampaign(input: SourcingSearchInput): Promise<SourcingSearchResult> {
  const queries = [input.product_keyword, ...(input.search_keywords ?? [])];
  return searchRawProducts(queries, { limit: input.limit, category: input.category ?? null });
}

/** Chấm điểm thô 1 ứng viên (chỉ tham khảo; relevance gate dùng product-relevance.ts). */
export function scoreSearchItem(item: SourcingSearchItem): number {
  let score = 40;
  if (item.image_urls.length > 0) score += 25;
  if (item.affiliate_link) score += 20;
  if (item.product_url) score += 8;
  if (item.price_note) score += 4;
  if (item.item_id) score += 3;
  return Math.min(100, score);
}
