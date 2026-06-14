import "server-only";

import crypto from "crypto";

/**
 * Phase 18 — Shopee Affiliate Open API client (per-account credentials).
 * Ký request: SHA256(appId + timestamp + payload + secret), gửi GraphQL.
 * KHÔNG throw. Lưu raw response để debug khi schema/ký sai.
 *
 * LƯU Ý: contract (field schema) CHƯA verify với key thật — dùng debug route
 * /api/debug/affiliate-api để kiểm tra & chỉnh field nếu Shopee trả 'errors'.
 */

export type ShopeeApiCredential = {
  app_id: string;
  app_secret: string;
  api_endpoint?: string | null;
};

export type ShopeeOffer = {
  itemId: string | null;
  shopId: string | null;
  productName: string | null;
  imageUrl: string | null;
  offerLink: string | null; // link affiliate đã gắn tracking của tài khoản
  productLink: string | null;
  priceMin: string | null;
  commissionRate: string | null;
};

export type ShopeeApiResult = {
  ok: boolean;
  offers: ShopeeOffer[];
  error?: string | null;
  raw?: unknown; // gọn, để debug
};

const DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.vn/graphql";

/** Ký Authorization header theo chuẩn Shopee Affiliate Open API. */
function buildAuthHeader(appId: string, secret: string, payload: string): { header: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  const factor = `${appId}${timestamp}${payload}${secret}`;
  const signature = crypto.createHash("sha256").update(factor).digest("hex");
  return {
    header: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    timestamp,
  };
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Gọi GraphQL Shopee Affiliate với credential cụ thể. KHÔNG throw. */
async function callGraphql(
  cred: ShopeeApiCredential,
  query: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; raw?: unknown }> {
  const appId = cred.app_id?.trim();
  const secret = cred.app_secret?.trim();
  const endpoint = cred.api_endpoint?.trim() || DEFAULT_ENDPOINT;
  if (!appId || !secret) return { ok: false, error: "Thiếu AppId/Secret của tài khoản." };

  // payload phải KHỚP CHÍNH XÁC body gửi đi (cùng chuỗi JSON).
  const payload = JSON.stringify({ query });
  const { header } = buildAuthHeader(appId, secret, payload);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: header },
      cache: "no-store",
      signal: controller.signal,
      body: payload,
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* giữ text */
    }
    if (!res.ok) {
      return { ok: false, error: `Shopee API HTTP ${res.status}`, raw: typeof json === "string" ? json.slice(0, 500) : json };
    }
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const msg = (obj.errors as Array<{ message?: string }>).map((e) => e.message).filter(Boolean).join("; ");
      return { ok: false, error: `Shopee API error: ${msg || "unknown"}`, raw: obj.errors };
    }
    return { ok: true, data: (obj.data as Record<string, unknown>) ?? {}, raw: obj };
  } catch (err) {
    const m = err instanceof Error ? (err.name === "AbortError" ? "Shopee API quá thời gian (20s)." : err.message) : "Shopee API lỗi.";
    return { ok: false, error: m.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** PUBLIC — gọi GraphQL Affiliate tùy ý (ký bằng key tài khoản). Dùng cho debug/introspection. */
export async function callShopeeAffiliateGraphql(
  cred: ShopeeApiCredential,
  query: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; raw?: unknown }> {
  return callGraphql(cred, query);
}

/**
 * Tìm offer sản phẩm theo từ khóa (productOfferV2). Trả danh sách offer của tài khoản.
 * Field schema có thể cần chỉnh sau khi test với key thật.
 */
export async function searchProductOffers(
  cred: ShopeeApiCredential,
  opts: { keyword: string; limit?: number; page?: number },
): Promise<ShopeeApiResult> {
  const keyword = (opts.keyword ?? "").trim();
  if (!keyword) return { ok: false, offers: [], error: "Thiếu từ khóa." };
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  // escape dấu nháy kép trong keyword cho query.
  const kw = keyword.replace(/"/g, '\\"');
  const query = `{
    productOfferV2(keyword: "${kw}", limit: ${limit}, page: ${page}) {
      nodes {
        itemId
        productName
        imageUrl
        offerLink
        productLink
        priceMin
        commissionRate
        shopId
      }
      pageInfo { page limit hasNextPage }
    }
  }`;

  const res = await callGraphql(cred, query);
  if (!res.ok) return { ok: false, offers: [], error: res.error, raw: res.raw };

  const data = res.data ?? {};
  const block = (data.productOfferV2 ?? {}) as Record<string, unknown>;
  const nodes = Array.isArray(block.nodes) ? (block.nodes as Array<Record<string, unknown>>) : [];
  const offers: ShopeeOffer[] = nodes.map((n) => ({
    itemId: str(n.itemId),
    shopId: str(n.shopId),
    productName: str(n.productName),
    imageUrl: str(n.imageUrl),
    offerLink: str(n.offerLink),
    productLink: str(n.productLink),
    priceMin: str(n.priceMin),
    commissionRate: str(n.commissionRate),
  }));

  return { ok: true, offers, raw: { count: offers.length, pageInfo: block.pageInfo } };
}

export type ShortLinkResult = {
  ok: boolean;
  shortLink: string | null;
  error?: string | null;
  raw?: unknown;
};

/**
 * Chuyển 1 URL sản phẩm Shopee thành short link affiliate (generateShortLink mutation).
 * Field schema có thể cần chỉnh sau khi test với key thật. KHÔNG throw.
 */
export async function generateAffiliateShortLink(
  cred: ShopeeApiCredential,
  opts: { originUrl: string; subIds?: string[] },
): Promise<ShortLinkResult> {
  const originUrl = (opts.originUrl ?? "").trim();
  if (!originUrl) return { ok: false, shortLink: null, error: "Thiếu URL gốc." };
  const subs = (opts.subIds ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().replace(/"/g, '\\"'));
  const subIdsArg = subs.length > 0 ? `, subIds: [${subs.map((s) => `"${s}"`).join(", ")}]` : "";
  const url = originUrl.replace(/"/g, '\\"');
  const query = `mutation{
    generateShortLink(input: { originUrl: "${url}"${subIdsArg} }) {
      shortLink
    }
  }`;

  const res = await callGraphql(cred, query);
  if (!res.ok) return { ok: false, shortLink: null, error: res.error, raw: res.raw };
  const data = res.data ?? {};
  const block = (data.generateShortLink ?? {}) as Record<string, unknown>;
  const shortLink = str(block.shortLink);
  if (!shortLink) return { ok: false, shortLink: null, error: "API không trả về shortLink.", raw: res.raw };
  return { ok: true, shortLink, raw: res.raw };
}
