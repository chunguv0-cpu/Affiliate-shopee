import "server-only";

import { getAllowedShopeeHost } from "@/lib/affiliate";

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
    const image = metaContent(html, "og:image");

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
