import "server-only";

import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";

/**
 * Product Data Provider adapter (Phase 17.11).
 * App lấy dữ liệu sản phẩm qua MỘT cửa duy nhất; nguồn thật đổi bằng env.
 * Providers: none | apify | custom_api. KHÔNG throw.
 */

export type ProductDataProvider = "none" | "apify" | "custom_api";

export type ProductDataResult = {
  ok: boolean;
  product_name?: string | null;
  image_urls?: string[];
  description?: string | null;
  category?: string | null;
  source?: string;
  error?: string | null;
};

export type ProductDataInput = {
  affiliate_link: string;
  resolved_url?: string | null;
  shop_id?: string | null;
  item_id?: string | null;
};

export function getProductDataProvider(): ProductDataProvider {
  const raw = process.env.PRODUCT_DATA_PROVIDER?.trim().toLowerCase();
  if (raw === "apify" || raw === "custom_api" || raw === "none") return raw;
  return "none";
}

export type ProductDataProviderConfig = {
  provider: ProductDataProvider;
  hasApifyToken: boolean;
  apifyActor: string | null;
  country: string;
  hasCustomApiBaseUrl: boolean;
  hasCustomApiKey: boolean;
  isConfigured: boolean;
  errors: string[];
};

export function getProductDataProviderConfig(): ProductDataProviderConfig {
  const provider = getProductDataProvider();
  const hasApifyToken = !!process.env.APIFY_TOKEN?.trim();
  const apifyActor = process.env.APIFY_SHOPEE_ACTOR?.trim() || "gio21~shopee-scraper";
  const country = process.env.PRODUCT_DATA_COUNTRY?.trim() || "VN";
  const hasCustomApiBaseUrl = !!process.env.PRODUCT_DATA_API_BASE_URL?.trim();
  const hasCustomApiKey = !!process.env.PRODUCT_DATA_API_KEY?.trim();
  const errors: string[] = [];

  if (provider === "apify" && !hasApifyToken) errors.push("APIFY_TOKEN is missing.");
  if (provider === "custom_api" && !hasCustomApiBaseUrl) errors.push("PRODUCT_DATA_API_BASE_URL is missing.");

  return {
    provider,
    hasApifyToken,
    apifyActor: provider === "apify" ? apifyActor : null,
    country,
    hasCustomApiBaseUrl,
    hasCustomApiKey,
    isConfigured: provider !== "none" && errors.length === 0,
    errors,
  };
}

/** Lọc + chuẩn hóa danh sách ảnh: hợp lệ, dedupe, tối đa 8. */
function cleanImages(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out = arr
    .filter((x): x is string => typeof x === "string")
    .map(normalizeImageUrl)
    .filter((u) => /^https?:\/\//i.test(u) && isLikelyProductImage(u));
  return Array.from(new Set(out)).slice(0, 8);
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Apify provider — actor gio21/shopee-scraper (field "location" = keyword/URL).
// ---------------------------------------------------------------------------
async function fetchViaApify(input: ProductDataInput): Promise<ProductDataResult> {
  const token = process.env.APIFY_TOKEN?.trim();
  const actor = process.env.APIFY_SHOPEE_ACTOR?.trim() || "gio21~shopee-scraper";
  const country = process.env.PRODUCT_DATA_COUNTRY?.trim() || "VN";
  if (!token) return { ok: false, source: "apify", error: "APIFY_TOKEN chưa cấu hình." };

  const target = pickString(input.resolved_url, input.affiliate_link);
  if (!target) return { ok: false, source: "apify", error: "Thiếu URL sản phẩm để truy vấn." };

  // run-sync: chạy actor và trả luôn dataset items. Giới hạn thời gian để tránh treo function.
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=110`;
  const body = { location: target, maxItems: 1, country, debug: false, priceSlicing: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 200);
      return { ok: false, source: "apify", error: `Apify HTTP ${res.status}: ${txt}` };
    }
    const data = (await res.json()) as unknown;
    const items = Array.isArray(data) ? data : [];
    if (items.length === 0) return { ok: false, source: "apify", error: "Apify không trả sản phẩm nào." };
    const item = items[0] as Record<string, unknown>;

    // gio21 trả mảng `images` URL đầy đủ; phòng hờ các tên field khác.
    const rawImages = (item.images ?? item.imageUrls ?? item.gallery ?? (item.image ? [item.image] : [])) as unknown;
    const image_urls = cleanImages(rawImages);
    if (image_urls.length === 0) {
      return { ok: false, source: "apify", error: "Apify trả về nhưng không có ảnh sản phẩm hợp lệ." };
    }
    return {
      ok: true,
      source: "apify",
      product_name: pickString(item.productName, item.name, item.title),
      image_urls,
      description: pickString(item.description),
      category: pickString(item.category, item.categoryName, item.breadcrumb),
      error: null,
    };
  } catch (err) {
    const m = err instanceof Error ? (err.name === "AbortError" ? "Apify quá thời gian (55s)." : err.message) : "Apify lỗi.";
    return { ok: false, source: "apify", error: m.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Custom API provider — POST {BASE_URL}/product-data (cho nguồn riêng sau này).
// ---------------------------------------------------------------------------
async function fetchViaCustomApi(input: ProductDataInput): Promise<ProductDataResult> {
  const base = process.env.PRODUCT_DATA_API_BASE_URL?.trim();
  const key = process.env.PRODUCT_DATA_API_KEY?.trim();
  if (!base) return { ok: false, source: "custom_api", error: "PRODUCT_DATA_API_BASE_URL chưa cấu hình." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/product-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        affiliate_link: input.affiliate_link,
        resolved_url: input.resolved_url ?? null,
        shop_id: input.shop_id ?? null,
        item_id: input.item_id ?? null,
      }),
    });
    if (!res.ok) return { ok: false, source: "custom_api", error: `HTTP ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    const image_urls = cleanImages(data.image_urls);
    if (image_urls.length === 0) return { ok: false, source: "custom_api", error: "API không trả ảnh hợp lệ." };
    return {
      ok: true,
      source: "custom_api",
      product_name: pickString(data.product_name),
      image_urls,
      description: pickString(data.description),
      category: pickString(data.category),
      error: null,
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : "custom_api lỗi.";
    return { ok: false, source: "custom_api", error: m.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** Cửa duy nhất: lấy dữ liệu sản phẩm theo provider đã cấu hình. KHÔNG throw. */
export async function fetchProductDataFromProvider(input: ProductDataInput): Promise<ProductDataResult> {
  const provider = getProductDataProvider();
  if (provider === "none") return { ok: false, source: "none", error: "PRODUCT_DATA_PROVIDER is none" };
  if (provider === "apify") return fetchViaApify(input);
  return fetchViaCustomApi(input);
}
