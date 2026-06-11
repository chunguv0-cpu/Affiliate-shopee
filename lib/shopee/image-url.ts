const NON_PRODUCT_IMAGE_RE =
  /(logo|favicon|sprite|placeholder|default|avatar|banner|qr[-_]?code|app[-_]?icon|appstore|googleplay|deo\.shopeemobile|\/web\/|icon[-_.]|\.svg|shopee[-_]?bag|tracking|pixel|1x1)/i;

const SHOPEE_IMAGE_CDN_RE = /(susercontent\.com|cf\.shopee\.vn|img\.susercontent\.com)/i;

export function normalizeImageUrl(url: string): string {
  let normalized = (url ?? "").trim();
  normalized = normalized
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  if (normalized.startsWith("//")) normalized = "https:" + normalized;
  return normalized;
}

/** Best-effort guard for real product images, shared by capture, UI, and jobs. */
export function isLikelyProductImage(url: string): boolean {
  const normalized = normalizeImageUrl(url);
  if (!/^https?:\/\//i.test(normalized)) return false;
  if (NON_PRODUCT_IMAGE_RE.test(normalized)) return false;

  const isShopeeCdnFile = SHOPEE_IMAGE_CDN_RE.test(normalized) && /\/file\//i.test(normalized);
  const hasImageExt = /\.(?:jpg|jpeg|png|webp)(?:$|[?#])/i.test(normalized);
  return isShopeeCdnFile || hasImageExt;
}

export function validProductImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((url): url is string => typeof url === "string")
        .map(normalizeImageUrl)
        .filter(isLikelyProductImage),
    ),
  );
}

export function hasValidProductImage(sourceImages: unknown, fallbackUrl?: string | null): boolean {
  if (validProductImageUrls(sourceImages).length > 0) return true;
  return typeof fallbackUrl === "string" && isLikelyProductImage(fallbackUrl);
}
