import "server-only";

import { getAllowedShopeeHost } from "@/lib/affiliate";
import { isLikelyProductImage } from "@/lib/shopee/image-url";
import type { ProductLifeStatus } from "@/lib/types";

/**
 * HOTFIX — Kiểm chứng sản phẩm Shopee còn tồn tại hay không.
 *
 * AN TOÀN: chỉ GET server-side (follow redirect), KHÔNG cookie/login/headless.
 * KHÔNG gọi bất kỳ API ảnh AI nào. KHÔNG throw.
 *
 * THẬN TRỌNG: Shopee hay chặn bot -> 1 SP sống vẫn có thể fetch lỗi.
 * Vì vậy chỉ đánh "chết" (NOT_FOUND/DELETED) khi có DẤU HIỆU RÕ RÀNG
 * (HTTP 404/410 hoặc marker "sản phẩm không tồn tại"). Trường hợp mơ hồ
 * (bị chặn/timeout/không có ảnh) -> UNKNOWN, KHÔNG hạ "chết" để tránh giết nhầm.
 */
export type ValidateProductResult = {
  ok: boolean;
  exists: boolean;
  product_status: ProductLifeStatus;
  shop_id?: string;
  item_id?: string;
  resolved_url?: string;
  product_name?: string;
  image_url?: string;
  source_product_images?: string[];
  error?: string;
};

export type ValidateProductInput = {
  affiliate_link?: string | null;
  original_url?: string | null;
  resolved_url?: string | null;
  shop_id?: string | null;
  item_id?: string | null;
  product_name?: string | null;
};

// Dấu hiệu sản phẩm/trang đã chết (tiếng Việt + tiếng Anh).
const DEAD_MARKERS = [
  /sản\s*phẩm[^<]{0,40}không\s*tồn\s*tại/i, // "sản phẩm ... không tồn tại"
  /sản\s*phẩm[^<]{0,40}đã\s*bị\s*xóa/i,  // "sản phẩm ... đã bị xóa"
  /sản\s*phẩm\s*này\s*không\s*tồn\s*tại/i, // "sản phẩm này không tồn tại"
  /product\s+not\s+found/i,
  /this\s+product\s+(is\s+)?no\s+longer\s+available/i,
  /page\s+not\s+found/i,
  /404\s*not\s*found/i,
];

const REGION_MARKERS = [
  /not\s+available\s+in\s+your\s+(region|country)/i,
  /không\s*khả\s*dụng\s*ở\s*khu\s*vực/i,
];

/** Tách shop_id + item_id từ URL sản phẩm Shopee. */
export function extractShopeeIds(url: string | null | undefined): { shopId: string | null; itemId: string | null } {
  const u = (url ?? "").trim();
  if (!u) return { shopId: null, itemId: null };
  // .../<slug>-i.<shopId>.<itemId>
  const mI = u.match(/-i\.(\d+)\.(\d+)/);
  if (mI) return { shopId: mI[1], itemId: mI[2] };
  // .../product/<shopId>/<itemId>
  const mP = u.match(/\/product\/(\d+)\/(\d+)/);
  if (mP) return { shopId: mP[1], itemId: mP[2] };
  return { shopId: null, itemId: null };
}

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

function metaContent(html: string, prop: string): string | null {
  const p = prop.replace(/[:]/g, "\\:");
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, "i");
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

function metaContentAll(html: string, prop: string): string[] {
  const p = prop.replace(/[:]/g, "\\:");
  const out: string[] = [];
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const v = decodeEntities(m[1]);
    if (v) out.push(v);
  }
  return out;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]) : null;
}

function dedupeImages(urls: string[]): string[] {
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

/**
 * Kiểm chứng 1 link sản phẩm. Trả product_status + ảnh nguồn nếu lấy được.
 * Ưu tiên URL gốc -> resolved -> affiliate (follow redirect để ra URL sản phẩm thật).
 */
export async function validateShopeeProductExists(input: ValidateProductInput): Promise<ValidateProductResult> {
  const candidates = [input.original_url, input.resolved_url, input.affiliate_link]
    .map((u) => (u ?? "").trim())
    .filter((u) => u.length > 0);
  const target = candidates[0] ?? "";

  if (!target) {
    return { ok: true, exists: false, product_status: "INVALID_URL", error: "Không có URL sản phẩm để kiểm chứng." };
  }
  if (!getAllowedShopeeHost(target)) {
    return { ok: true, exists: false, product_status: "INVALID_URL", error: "Link không thuộc domain Shopee hợp lệ." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(target, {
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
    const resolvedUrl = res.url || target;
    const ids = extractShopeeIds(resolvedUrl);
    const shopId = input.shop_id ?? ids.shopId ?? undefined;
    const itemId = input.item_id ?? ids.itemId ?? undefined;

    // HTTP 404/410 -> chắc chắn không tồn tại.
    if (res.status === 404 || res.status === 410) {
      return { ok: true, exists: false, product_status: "NOT_FOUND", resolved_url: resolvedUrl, shop_id: shopId, item_id: itemId, error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) {
      // Bị chặn / không phải HTML -> KHÔNG kết luận chết.
      return {
        ok: false,
        exists: false,
        product_status: "UNKNOWN",
        resolved_url: resolvedUrl,
        shop_id: shopId,
        item_id: itemId,
        error: `Không đọc được trang sản phẩm (HTTP ${res.status}).`,
      };
    }

    const raw = await res.text();
    const html = raw.slice(0, 500_000);

    // Dấu hiệu chết rõ ràng trong HTML.
    if (DEAD_MARKERS.some((re) => re.test(html))) {
      return { ok: true, exists: false, product_status: "NOT_FOUND", resolved_url: resolvedUrl, shop_id: shopId, item_id: itemId, error: "Trang báo sản phẩm không tồn tại/đã gỡ." };
    }
    if (REGION_MARKERS.some((re) => re.test(html))) {
      return { ok: true, exists: false, product_status: "REGION_BLOCKED", resolved_url: resolvedUrl, shop_id: shopId, item_id: itemId, error: "Sản phẩm bị chặn theo khu vực." };
    }

    const name = metaContent(html, "og:title") ?? titleTag(html);
    const ogImages = [
      ...metaContentAll(html, "og:image"),
      ...metaContentAll(html, "og:image:url"),
      ...metaContentAll(html, "og:image:secure_url"),
      ...metaContentAll(html, "twitter:image"),
      ...metaContentAll(html, "twitter:image:src"),
    ];
    const images = dedupeImages(ogImages).filter(isLikelyProductImage).slice(0, 8);

    if (images.length > 0) {
      // Có ảnh sản phẩm thật + không có marker chết -> coi là còn sống.
      return {
        ok: true,
        exists: true,
        product_status: "ACTIVE",
        resolved_url: resolvedUrl,
        shop_id: shopId,
        item_id: itemId,
        product_name: name ?? input.product_name ?? undefined,
        image_url: images[0],
        source_product_images: images,
      };
    }

    // Trang tải được nhưng không thấy ảnh (Shopee render JS / chặn bot) -> chưa xác định.
    return {
      ok: false,
      exists: false,
      product_status: "UNKNOWN",
      resolved_url: resolvedUrl,
      shop_id: shopId,
      item_id: itemId,
      product_name: name ?? input.product_name ?? undefined,
      error: "Không lấy được ảnh sản phẩm để xác nhận (có thể bị chặn bot).",
    };
  } catch (err) {
    return {
      ok: false,
      exists: false,
      product_status: "UNKNOWN",
      error: err instanceof Error ? (err.name === "AbortError" ? "Kiểm chứng quá thời gian (9s)." : err.message.slice(0, 200)) : "Lỗi kiểm chứng link.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Map kết quả validate -> patch cập nhật bảng products. */
export function buildProductValidationPatch(result: ValidateProductResult): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    product_status: result.product_status,
    last_validated_at: nowIso,
    updated_at: nowIso,
  };
  if (result.resolved_url) patch.resolved_url = result.resolved_url;
  if (result.shop_id) patch.shop_id = result.shop_id;
  if (result.item_id) patch.item_id = result.item_id;

  if (result.exists && result.product_status === "ACTIVE") {
    patch.validation_status = result.source_product_images && result.source_product_images.length > 0 ? "VALID" : "MISSING_IMAGE";
    patch.validation_error = null;
    if (result.image_url) patch.image_url = result.image_url;
    if (result.source_product_images && result.source_product_images.length > 0) {
      patch.source_product_images = result.source_product_images;
    }
  } else if (result.product_status === "UNKNOWN") {
    patch.validation_status = "VALIDATION_FAILED";
    patch.validation_error = result.error ?? null;
  } else {
    // NOT_FOUND / DELETED / UNAVAILABLE / REGION_BLOCKED / INVALID_URL
    patch.validation_status = "DEAD";
    patch.validation_error = result.error ?? null;
  }
  return patch;
}
