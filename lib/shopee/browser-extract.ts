import "server-only";

import { isLikelyProductImage } from "@/lib/shopee/enrich";

/**
 * HOTFIX 17.6 — Browser-render extractor cho ảnh sản phẩm Shopee.
 * Dùng remote Chromium (Browserless) qua puppeteer-core CONNECT (KHÔNG bundle Chromium).
 * KHÔNG cookie/login. Chỉ render trang sản phẩm công khai.
 */

export type ShopeeImageSourceProvider = "server_fetch" | "browserless" | "manual_fallback";

export function getShopeeImageSourceProvider(): ShopeeImageSourceProvider {
  const raw = process.env.SHOPEE_IMAGE_SOURCE_PROVIDER?.trim().toLowerCase();
  if (raw === "browserless" || raw === "manual_fallback" || raw === "server_fetch") return raw;
  return "server_fetch";
}

/** Có cấu hình browserless không (endpoint WS). */
export function isBrowserExtractConfigured(): boolean {
  return getShopeeImageSourceProvider() === "browserless" && !!process.env.BROWSERLESS_WS_ENDPOINT?.trim();
}

function buildWsEndpoint(): string | null {
  const ep = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!ep) return null;
  const token = process.env.BROWSERLESS_API_TOKEN?.trim();
  if (token && !/[?&]token=/.test(ep)) {
    return ep.includes("?") ? `${ep}&token=${token}` : `${ep}?token=${token}`;
  }
  return ep;
}

export type BrowserExtractResult = {
  ok: boolean;
  image_urls: string[];
  status: "SUCCESS" | "FAILED" | "NOT_CONFIGURED";
  error: string | null;
  candidatesCount: number;
  validCount: number;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Render trang Shopee bằng remote browser, thu URL ảnh. KHÔNG throw.
 */
export async function extractShopeeImagesWithBrowser(url: string): Promise<BrowserExtractResult> {
  const base: BrowserExtractResult = {
    ok: false,
    image_urls: [],
    status: "NOT_CONFIGURED",
    error: null,
    candidatesCount: 0,
    validCount: 0,
  };
  if (!isBrowserExtractConfigured()) {
    return { ...base, error: "Browser extractor chưa cấu hình (SHOPEE_IMAGE_SOURCE_PROVIDER=browserless + BROWSERLESS_WS_ENDPOINT)." };
  }
  const wsEndpoint = buildWsEndpoint();
  if (!wsEndpoint) return { ...base, error: "Thiếu BROWSERLESS_WS_ENDPOINT." };

  let browser: { close: () => Promise<void>; newPage: () => Promise<unknown> } | null = null;
  try {
    const mod = (await import("puppeteer-core")) as unknown as {
      default: { connect: (opts: { browserWSEndpoint: string }) => Promise<typeof browser> };
    };
    const puppeteer = mod.default;
    browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    if (!browser) return { ...base, status: "FAILED", error: "Không kết nối được remote browser." };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page: any = await browser.newPage();
    await page.setUserAgent(UA);
    try {
      await page.setExtraHTTPHeaders({ "Accept-Language": "vi-VN,vi;q=0.9" });
    } catch {
      /* ignore */
    }
    page.setDefaultNavigationTimeout(20000);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    // Chờ ảnh gallery xuất hiện (best-effort).
    await page.waitForSelector("img", { timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const urls: string[] = await page.evaluate(() => {
      const found: string[] = [];
      const push = (u: string | null | undefined) => {
        if (u && typeof u === "string") found.push(u);
      };
      document.querySelectorAll("img").forEach((el) => {
        const img = el as HTMLImageElement;
        push(img.src);
        const ss = img.getAttribute("srcset");
        if (ss) ss.split(",").forEach((part) => push(part.trim().split(/\s+/)[0]));
      });
      document.querySelectorAll("picture source").forEach((el) => {
        const ss = el.getAttribute("srcset");
        if (ss) ss.split(",").forEach((part) => push(part.trim().split(/\s+/)[0]));
      });
      document.querySelectorAll<HTMLElement>("[style*='background-image']").forEach((el) => {
        const m = el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) push(m[1]);
      });
      return Array.from(new Set(found));
    });

    const candidates = Array.from(new Set((urls ?? []).map((u) => (u ?? "").trim()).filter((u) => /^https?:\/\//i.test(u))));
    const valid = candidates.filter(isLikelyProductImage).slice(0, 8);

    return {
      ok: valid.length > 0,
      image_urls: valid,
      status: "SUCCESS",
      error: null,
      candidatesCount: candidates.length,
      validCount: valid.length,
    };
  } catch (err) {
    return { ...base, status: "FAILED", error: err instanceof Error ? err.message.slice(0, 200) : "browser error" };
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
