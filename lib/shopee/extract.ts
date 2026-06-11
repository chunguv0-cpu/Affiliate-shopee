import "server-only";

import { getAllowedShopeeHost } from "@/lib/affiliate";
import { isLikelyProductImage } from "@/lib/shopee/enrich";

/**
 * HOTFIX 17.5 — Trích ảnh sản phẩm Shopee BỀN HƠN + chẩn đoán.
 * Thử nhiều chiến lược trước khi bỏ cuộc. KHÔNG cookie/login/headless.
 */

export type ShopeeExtractDiagnostics = {
  originalUrl: string;
  resolvedUrl?: string | null;
  finalUrl?: string | null;
  httpStatus?: number | null;
  htmlLength?: number;
  detectedShopId?: string | null;
  detectedItemId?: string | null;
  imageCandidatesCount: number;
  validImagesCount: number;
  rejectedImages: Array<{ url: string; reason: string }>;
  strategiesTried: string[];
  error?: string | null;
};

export type ShopeeExtractResult = {
  ok: boolean;
  product_name: string | null;
  image_urls: string[];
  diagnostics: ShopeeExtractDiagnostics;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IMG_CDN_BASE = "https://down-vn.img.susercontent.com/file/";

function unescapeUrl(s: string): string {
  return s
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}

function metaContent(html: string, prop: string): string | null {
  const p = prop.replace(/[:]/g, "\\:");
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]) : null;
}

/** Parse shopId/itemId từ URL Shopee (nhiều dạng). */
export function parseShopeeIds(url: string): { shopId: string | null; itemId: string | null } {
  if (!url) return { shopId: null, itemId: null };
  // -i.{shopid}.{itemid}
  let m = url.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  // /product/{shopid}/{itemid}
  m = url.match(/\/product\/(\d+)\/(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  // query params
  try {
    const u = new URL(url);
    const shopId = u.searchParams.get("shopId") ?? u.searchParams.get("shop_id");
    const itemId = u.searchParams.get("itemId") ?? u.searchParams.get("item_id");
    if (shopId || itemId) return { shopId, itemId };
  } catch {
    /* ignore */
  }
  return { shopId: null, itemId: null };
}

/** Resolve link affiliate -> URL cuối (follow redirect). Trả html luôn để tiết kiệm request. */
export async function resolveShopeeAffiliateUrl(
  url: string,
): Promise<{ finalUrl: string; status: number | null; html: string | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    const finalUrl = res.url || url;
    const contentType = res.headers.get("content-type") ?? "";
    let html: string | null = null;
    if (contentType.includes("text/html")) {
      const raw = await res.text();
      html = raw.slice(0, 800_000);
    }
    return { finalUrl, status: res.status, html, error: null };
  } catch (err) {
    return { finalUrl: url, status: null, html: null, error: err instanceof Error ? err.message.slice(0, 200) : "fetch error" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Thu thập URL ảnh ứng viên từ HTML (meta + JSON-LD + CDN regex + hash arrays). */
function collectCandidates(html: string, strategies: string[]): string[] {
  const out: string[] = [];

  // B) meta tags
  const metas = [
    metaContent(html, "og:image"),
    metaContent(html, "og:image:url"),
    metaContent(html, "og:image:secure_url"),
    metaContent(html, "twitter:image"),
    metaContent(html, "twitter:image:src"),
  ].filter((x): x is string => !!x);
  if (metas.length) {
    strategies.push("meta-tags");
    out.push(...metas.map(unescapeUrl));
  }

  // E) regex CDN image URLs (cả dạng escaped \/).
  const cdnRe = /https?:(?:\\\/|\/)(?:\\\/|\/)[^"'\\\s)]*?(?:susercontent\.com|cf\.shopee\.vn)(?:\\\/|\/)[^"'\\\s)]+/gi;
  let cm: RegExpExecArray | null;
  let cdnFound = 0;
  while ((cm = cdnRe.exec(html)) !== null) {
    out.push(unescapeUrl(cm[0]));
    cdnFound += 1;
    if (cdnFound > 60) break;
  }
  if (cdnFound > 0) strategies.push("cdn-regex");

  // C) hash arrays: "images":["<hash>",...] hoặc "image":"<hash>"
  let hashFound = 0;
  const imagesArrRe = /"images?"\s*:\s*\[([^\]]{0,4000})\]/gi;
  let am: RegExpExecArray | null;
  while ((am = imagesArrRe.exec(html)) !== null) {
    const tokens = am[1].match(/[a-z0-9]{24,}/gi) ?? [];
    for (const t of tokens) {
      out.push(IMG_CDN_BASE + t);
      hashFound += 1;
    }
    if (hashFound > 60) break;
  }
  const singleImgRe = /"image"\s*:\s*"([a-z0-9]{24,})"/gi;
  let sm: RegExpExecArray | null;
  while ((sm = singleImgRe.exec(html)) !== null) {
    out.push(IMG_CDN_BASE + sm[1]);
    hashFound += 1;
    if (hashFound > 80) break;
  }
  if (hashFound > 0) strategies.push("hash-arrays");

  // JSON-LD image fields.
  const ldRe = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let lm: RegExpExecArray | null;
  let ldFound = 0;
  while ((lm = ldRe.exec(html)) !== null) {
    const imgs = lm[1].match(/"image"\s*:\s*("[^"]+"|\[[^\]]+\])/i);
    if (imgs) {
      const urls = imgs[1].match(/https?:[^"']+/g) ?? [];
      for (const u of urls) {
        out.push(unescapeUrl(u));
        ldFound += 1;
      }
    }
  }
  if (ldFound > 0) strategies.push("json-ld");

  return out;
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const res: string[] = [];
  for (const u of urls) {
    const t = (u ?? "").trim();
    if (!t || !/^https?:\/\//i.test(t) || seen.has(t)) continue;
    seen.add(t);
    res.push(t);
  }
  return res;
}

function rankCdnFirst(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const sa = /susercontent\.com\/file\//i.test(a) ? 0 : 1;
    const sb = /susercontent\.com\/file\//i.test(b) ? 0 : 1;
    return sa - sb;
  });
}

/** Trích ảnh sản phẩm + chẩn đoán đầy đủ. KHÔNG throw. */
export async function extractShopeeProductImages(url: string): Promise<ShopeeExtractResult> {
  const diagnostics: ShopeeExtractDiagnostics = {
    originalUrl: url,
    resolvedUrl: null,
    finalUrl: null,
    httpStatus: null,
    htmlLength: 0,
    detectedShopId: null,
    detectedItemId: null,
    imageCandidatesCount: 0,
    validImagesCount: 0,
    rejectedImages: [],
    strategiesTried: [],
    error: null,
  };

  if (!getAllowedShopeeHost(url)) {
    diagnostics.error = "Link không thuộc domain Shopee hợp lệ.";
    return { ok: false, product_name: null, image_urls: [], diagnostics };
  }

  const resolved = await resolveShopeeAffiliateUrl(url);
  diagnostics.resolvedUrl = resolved.finalUrl;
  diagnostics.finalUrl = resolved.finalUrl;
  diagnostics.httpStatus = resolved.status;
  diagnostics.strategiesTried.push("resolve-redirect");

  const ids = parseShopeeIds(resolved.finalUrl) ;
  diagnostics.detectedShopId = ids.shopId;
  diagnostics.detectedItemId = ids.itemId;
  diagnostics.strategiesTried.push("parse-ids");

  const html = resolved.html;
  if (!html) {
    diagnostics.error = resolved.error ?? `Không đọc được HTML (HTTP ${resolved.status ?? "?"}).`;
    return { ok: false, product_name: null, image_urls: [], diagnostics };
  }
  diagnostics.htmlLength = html.length;

  const productName = metaContent(html, "og:title") ?? titleTag(html);
  const candidates = dedupe(collectCandidates(html, diagnostics.strategiesTried));
  diagnostics.imageCandidatesCount = candidates.length;

  const valid: string[] = [];
  for (const c of candidates) {
    if (isLikelyProductImage(c)) valid.push(c);
    else if (diagnostics.rejectedImages.length < 12) {
      diagnostics.rejectedImages.push({ url: c.slice(0, 200), reason: "không giống ảnh sản phẩm (logo/icon/khác CDN)" });
    }
  }
  const finalImages = rankCdnFirst(dedupe(valid)).slice(0, 8);
  diagnostics.validImagesCount = finalImages.length;

  return {
    ok: finalImages.length > 0,
    product_name: productName,
    image_urls: finalImages,
    diagnostics,
  };
}
