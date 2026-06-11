import "server-only";

/**
 * HOTFIX 17.6 / 17.6.1 — Browser-render extractor cho ảnh sản phẩm Shopee.
 * Remote Chromium (Browserless) qua puppeteer-core CONNECT. KHÔNG cookie/login.
 */

export type ShopeeImageSourceProvider = "server_fetch" | "browserless" | "manual_fallback";

export function getShopeeImageSourceProvider(): ShopeeImageSourceProvider {
  const raw = process.env.SHOPEE_IMAGE_SOURCE_PROVIDER?.trim().toLowerCase();
  if (raw === "browserless" || raw === "manual_fallback" || raw === "server_fetch") return raw;
  return "server_fetch";
}

export function isBrowserExtractConfigured(): boolean {
  return getShopeeImageSourceProvider() === "browserless" && !!process.env.BROWSERLESS_WS_ENDPOINT?.trim();
}

function buildWsEndpoint(): string | null {
  const ep = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!ep) return null;
  const token = process.env.BROWSERLESS_API_TOKEN?.trim();
  if (token && !/[?&]token=/.test(ep)) return ep.includes("?") ? `${ep}&token=${token}` : `${ep}?token=${token}`;
  return ep;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NON_PRODUCT_RE =
  /(logo|favicon|sprite|placeholder|default|avatar|banner|qr[-_]?code|app[-_]?icon|appstore|googleplay|deo\.shopeemobile|\/web\/|icon[-_.]|\.svg|shopee[-_]?bag|tracking|pixel|1x1)/i;
const SHOPEE_CDN_RE = /(susercontent\.com|cf\.shopee\.vn|img\.susercontent\.com)/i;

/** Chuẩn hóa URL ảnh Shopee. */
export function normalizeShopeeImageUrl(u: string): string {
  let s = (u ?? "").trim();
  s = s.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (s.startsWith("//")) s = "https:" + s;
  return s;
}

/** Hợp lệ nếu là ảnh CDN Shopee (kể cả không có đuôi file) và KHÔNG phải logo/icon. */
function isValidShopeeImage(url: string): boolean {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (NON_PRODUCT_RE.test(u)) return false;
  if (SHOPEE_CDN_RE.test(u)) return true;
  return /\.(?:jpg|jpeg|png|webp)(?:$|[?#])/i.test(u);
}

export type BrowserExtractResult = {
  ok: boolean;
  image_urls: string[];
  status: "SUCCESS" | "FAILED" | "NOT_CONFIGURED";
  error: string | null;
  diagnostics: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Render trang Shopee, thu ảnh từ DOM + network. KHÔNG throw. */
export async function extractShopeeImagesWithBrowser(url: string): Promise<BrowserExtractResult> {
  const diagnostics: Record<string, unknown> = {
    strategiesTried: ["browser-dom-img-scan", "browser-background-image-scan", "browser-network-image-capture"],
  };
  if (!isBrowserExtractConfigured()) {
    return { ok: false, image_urls: [], status: "NOT_CONFIGURED", error: "Browser extractor chưa cấu hình.", diagnostics };
  }
  const wsEndpoint = buildWsEndpoint();
  if (!wsEndpoint) return { ok: false, image_urls: [], status: "NOT_CONFIGURED", error: "Thiếu BROWSERLESS_WS_ENDPOINT.", diagnostics };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  try {
    const mod = (await import("puppeteer-core")) as unknown as { default: { connect: (o: { browserWSEndpoint: string }) => Promise<unknown> } };
    browser = await mod.default.connect({ browserWSEndpoint: wsEndpoint });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page: any = await browser.newPage();
    await page.setUserAgent(UA);
    try {
      await page.setExtraHTTPHeaders({ "Accept-Language": "vi-VN,vi;q=0.9" });
    } catch {
      /* ignore */
    }
    page.setDefaultNavigationTimeout(25000);

    // Network capture: bắt URL ảnh CDN Shopee từ response.
    const networkImages = new Set<string>();
    page.on("response", (res: { url: () => string; headers: () => Record<string, string> }) => {
      try {
        const u = res.url();
        const ct = (res.headers()?.["content-type"] ?? "").toLowerCase();
        if (SHOPEE_CDN_RE.test(u) && (ct.includes("image") || isValidShopeeImage(u))) networkImages.add(u);
      } catch {
        /* ignore */
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await sleep(3500);
    // Scroll để kích lazy-load.
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight / 2))).catch(() => {});
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(2000);

    const dom = (await page
      .evaluate(() => {
        const urls: string[] = [];
        const push = (u: string | null | undefined) => {
          if (u && typeof u === "string") urls.push(u);
        };
        const imgs = document.querySelectorAll("img");
        imgs.forEach((el) => {
          ["src", "data-src", "data-original", "data-lazy-src"].forEach((a) => push(el.getAttribute(a)));
          const ss = el.getAttribute("srcset");
          if (ss) ss.split(",").forEach((p) => push(p.trim().split(/\s+/)[0]));
        });
        document.querySelectorAll("picture source").forEach((el) => {
          const ss = el.getAttribute("srcset");
          if (ss) ss.split(",").forEach((p) => push(p.trim().split(/\s+/)[0]));
        });
        let bgCount = 0;
        document.querySelectorAll<HTMLElement>("[style*='background-image']").forEach((el) => {
          const st = el.getAttribute("style") ?? "";
          const m = st.match(/url\((["']?)([^"')]+)\1\)/);
          if (m) {
            push(m[2]);
            bgCount += 1;
          }
        });
        const bodyText = (document.body?.innerText ?? "").slice(0, 500);
        return { urls: Array.from(new Set(urls)), imgCount: imgs.length, bgCount, bodyText };
      })
      .catch(() => ({ urls: [] as string[], imgCount: 0, bgCount: 0, bodyText: "" }))) as {
      urls: string[];
      imgCount: number;
      bgCount: number;
      bodyText: string;
    };

    let pageTitle = "";
    let finalUrl = url;
    try {
      pageTitle = await page.title();
      finalUrl = page.url();
    } catch {
      /* ignore */
    }

    const rawCandidates = Array.from(new Set([...dom.urls, ...Array.from(networkImages)].map(normalizeShopeeImageUrl).filter(Boolean)));
    const valid: string[] = [];
    const rejected: Array<{ url: string; reason: string }> = [];
    for (const c of rawCandidates) {
      if (isValidShopeeImage(c)) valid.push(c);
      else if (rejected.length < 10) rejected.push({ url: c.slice(0, 180), reason: NON_PRODUCT_RE.test(c) ? "logo/icon/non-product" : "không phải CDN Shopee / không có đuôi ảnh" });
    }
    // Ưu tiên ảnh CDN /file/ rồi tới CDN khác.
    valid.sort((a, b) => (/\/file\//i.test(b) ? 1 : 0) - (/\/file\//i.test(a) ? 1 : 0));
    const finalImages = Array.from(new Set(valid)).slice(0, 8);

    diagnostics.browserFinalUrl = finalUrl;
    diagnostics.browserPageTitle = pageTitle;
    diagnostics.browserImgTagCount = dom.imgCount;
    diagnostics.browserBackgroundImageCount = dom.bgCount;
    diagnostics.browserNetworkImageCount = networkImages.size;
    diagnostics.browserCandidateImageCount = rawCandidates.length;
    diagnostics.browserValidImagesCount = finalImages.length;
    diagnostics.browserVisibleTextSample = dom.bodyText;
    diagnostics.browserRawCandidates = rawCandidates.slice(0, 10);
    diagnostics.browserRejected = rejected;
    diagnostics.browserFirstValidImages = finalImages.slice(0, 5);

    return { ok: finalImages.length > 0, image_urls: finalImages, status: "SUCCESS", error: null, diagnostics };
  } catch (err) {
    diagnostics.browserError = err instanceof Error ? err.message.slice(0, 200) : "browser error";
    return { ok: false, image_urls: [], status: "FAILED", error: diagnostics.browserError as string, diagnostics };
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
