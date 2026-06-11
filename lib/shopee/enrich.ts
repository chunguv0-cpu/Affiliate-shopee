import "server-only";

import { getAllowedShopeeHost } from "@/lib/affiliate";
import { isLikelyProductImage } from "@/lib/shopee/image-url";

export { isLikelyProductImage } from "@/lib/shopee/image-url";

/**
 * Enrich link affiliate Shopee bằng metadata công khai (Open Graph / <title>).
 *
 * AN TOÀN: chỉ fetch server-side, KHÔNG cookie, KHÔNG login, KHÔNG headless browser.
 * Shopee có thể chặn bot hoặc render bằng JS → metadata có thể thiếu (source = "fallback").
 * Hàm này KHÔNG throw — luôn trả về EnrichedShopeeLink để 1 link lỗi không làm chết import.
 */
export type EnrichedShopeeLink = {
  affiliate_link: string;
  resolved_url?: string | null;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  source: "metadata" | "ai" | "fallback";
};

/** Giải mã một vài HTML entity phổ biến. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Lấy nội dung meta theo property/name (vd og:title). */
function metaContent(html: string, prop: string): string | null {
  const p = prop.replace(/[:]/g, "\\:");
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`,
    "i",
  );
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]) : null;
}

/** Lấy TẤT CẢ content của các thẻ meta theo property/name (vd nhiều og:image). */
function metaContentAll(html: string, prop: string): string[] {
  const p = prop.replace(/[:]/g, "\\:");
  const out: string[] = [];
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const v = decodeEntities(m[1]);
    if (v) out.push(v);
  }
  return out;
}

/** Quét URL ảnh CDN Shopee xuất hiện trong HTML (best-effort, không scrape sâu). */
function shopeeCdnImages(html: string): string[] {
  const out: string[] = [];
  // down-vn.img.susercontent.com / cf.shopee.vn / cdn ... đuôi ảnh hoặc id ảnh.
  const re = /https?:\/\/[^"'\s)]+(?:susercontent\.com|shopee[^"'\s)]*)\/[^"'\s)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = m[0];
    if (/\.(?:jpg|jpeg|png|webp)(?:$|[?#])/i.test(u) || /susercontent\.com\/[a-z0-9]+$/i.test(u)) {
      out.push(u);
    }
    if (out.length > 30) break;
  }
  return out;
}

/** Sắp xếp ưu tiên ảnh sản phẩm Shopee CDN /file/ lên trước. */
function rankProductImages(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const sa = /susercontent\.com\/file\//i.test(a) ? 0 : 1;
    const sb = /susercontent\.com\/file\//i.test(b) ? 0 : 1;
    return sa - sb;
  });
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = (u ?? "").trim();
    if (!t || !/^https?:\/\//i.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export type ShopeeProductData = {
  product_url: string | null;
  product_name: string | null;
  image_urls: string[];
  description: string | null;
  category: string | null;
  ok: boolean;
  error?: string | null;
};

/**
 * HOTFIX 17.3 — Resolve link affiliate Shopee + trích dữ liệu sản phẩm THẬT.
 * Trả nhiều ảnh nếu lấy được (og:image* + quét CDN). KHÔNG scrape browser, KHÔNG cookie.
 * Shopee có thể chặn/JS-render -> có thể chỉ lấy được og:image (1 ảnh). KHÔNG throw.
 */
export async function extractShopeeProductData(affiliateLink: string): Promise<ShopeeProductData> {
  const base: ShopeeProductData = {
    product_url: null,
    product_name: null,
    image_urls: [],
    description: null,
    category: null,
    ok: false,
    error: null,
  };
  if (!getAllowedShopeeHost(affiliateLink)) {
    return { ...base, error: "Link không thuộc domain Shopee hợp lệ." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(affiliateLink, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const resolvedUrl = res.url || affiliateLink; // đã follow short link -> URL sản phẩm
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) {
      return { ...base, product_url: resolvedUrl, error: `Không đọc được trang sản phẩm (HTTP ${res.status}).` };
    }
    const raw = await res.text();
    const html = raw.slice(0, 500_000);

    const name = metaContent(html, "og:title") ?? titleTag(html);
    const description = metaContent(html, "og:description");
    const ogImages = [
      ...metaContentAll(html, "og:image"),
      ...metaContentAll(html, "og:image:url"),
      ...metaContentAll(html, "og:image:secure_url"),
      ...metaContentAll(html, "twitter:image"),
      ...metaContentAll(html, "twitter:image:src"),
    ];
    // Chỉ giữ ảnh sản phẩm thật (loại logo/icon), ưu tiên ảnh CDN /file/.
    const valid = rankProductImages(dedupe([...ogImages, ...shopeeCdnImages(html)]).filter(isLikelyProductImage)).slice(0, 8);

    return {
      product_url: resolvedUrl,
      product_name: name,
      image_urls: valid,
      description: description ?? null,
      category: null,
      ok: valid.length > 0,
      error: valid.length > 0 ? null : "Không lấy được ảnh sản phẩm thật từ Shopee (chỉ thấy logo/icon).",
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message.slice(0, 200) : "Lỗi tải trang sản phẩm." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichShopeeAffiliateLink(
  affiliateLink: string,
): Promise<EnrichedShopeeLink> {
  const base: EnrichedShopeeLink = {
    affiliate_link: affiliateLink,
    resolved_url: null,
    title: null,
    description: null,
    image_url: null,
    source: "fallback",
  };

  // Chỉ cho domain Shopee hợp lệ.
  if (!getAllowedShopeeHost(affiliateLink)) {
    return base;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(affiliateLink, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        // User-Agent giống trình duyệt để tăng cơ hội nhận HTML (không cookie).
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const resolvedUrl = res.url || affiliateLink;
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) {
      return { ...base, resolved_url: resolvedUrl };
    }

    // Đọc tối đa ~300KB để tránh body quá lớn.
    const raw = await res.text();
    const html = raw.slice(0, 300_000);

    const title = metaContent(html, "og:title") ?? titleTag(html);
    const description = metaContent(html, "og:description");
    // Hotfix 17.1: ưu tiên nhiều nguồn ảnh thật (og:image -> og:image:url -> twitter:image).
    const image =
      metaContent(html, "og:image") ??
      metaContent(html, "og:image:url") ??
      metaContent(html, "og:image:secure_url") ??
      metaContent(html, "twitter:image") ??
      metaContent(html, "twitter:image:src");

    const hasMeta = Boolean(title || description || image);
    return {
      affiliate_link: affiliateLink,
      resolved_url: resolvedUrl,
      title: title ?? null,
      description: description ?? null,
      image_url: image ?? null,
      source: hasMeta ? "metadata" : "fallback",
    };
  } catch {
    // Timeout / bị chặn / lỗi mạng → fallback có kiểm soát, không throw.
    return base;
  } finally {
    clearTimeout(timeout);
  }
}
