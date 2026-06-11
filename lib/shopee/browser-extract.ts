import "server-only";

import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";

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

type ProxyConfig = {
  mode: "external" | "chrome_arg";
  browserlessProxy: string | null;
  browserlessProxyCountry: string | null;
  browserlessProxySticky: string | null;
  browserlessProxyLocaleMatch: string | null;
  customProxySource: "BROWSERLESS_PROXY_URL" | "BROWSERLESS_PROXY" | null;
  browserlessProxyEnvLooksCustom: boolean;
  externalProxyServer: string | null;
  chromeProxyServer: string | null;
  username: string | null;
  password: string | null;
};

function appendParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function parseExternalProxyServer(raw: string | null): {
  externalProxyServer: string | null;
  chromeProxyServer: string | null;
  username: string | null;
  password: string | null;
} {
  const value = raw?.trim();
  if (!value) {
    return { externalProxyServer: null, chromeProxyServer: null, username: null, password: null };
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const username = parsed.username ? decodeURIComponent(parsed.username) : null;
      const password = parsed.password ? decodeURIComponent(parsed.password) : null;
      parsed.username = "";
      parsed.password = "";
      const chromeProxyServer = parsed.toString().replace(/\/$/, "");
      return { externalProxyServer: value, chromeProxyServer, username, password };
    } catch {
      return { externalProxyServer: value, chromeProxyServer: value, username: null, password: null };
    }
  }

  const parts = value.split(":");
  if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
    const [host, port, username, ...passwordParts] = parts;
    const password = passwordParts.join(":");
    return {
      externalProxyServer: `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`,
      chromeProxyServer: `http://${host}:${port}`,
      username,
      password,
    };
  }

  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { externalProxyServer: `http://${value}`, chromeProxyServer: `http://${value}`, username: null, password: null };
  }

  return { externalProxyServer: value, chromeProxyServer: value, username: null, password: null };
}

function looksLikeExternalProxy(value: string | null): boolean {
  const raw = value?.trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  const parts = raw.split(":");
  return parts.length >= 2 && /^\d+$/.test(parts[1]);
}

function readProxyConfig(): ProxyConfig {
  const rawMode = process.env.BROWSERLESS_PROXY_MODE?.trim().toLowerCase();
  const mode: ProxyConfig["mode"] = rawMode === "chrome_arg" ? "chrome_arg" : "external";
  const rawBrowserlessProxy = process.env.BROWSERLESS_PROXY?.trim() || null;
  const rawProxyUrl = process.env.BROWSERLESS_PROXY_URL?.trim() || null;
  const browserlessProxyEnvLooksCustom = looksLikeExternalProxy(rawBrowserlessProxy);
  const rawCustomProxy = rawProxyUrl || (browserlessProxyEnvLooksCustom ? rawBrowserlessProxy : null);
  const customProxySource = rawProxyUrl ? "BROWSERLESS_PROXY_URL" : browserlessProxyEnvLooksCustom ? "BROWSERLESS_PROXY" : null;
  const browserlessProxy = browserlessProxyEnvLooksCustom ? null : rawBrowserlessProxy;
  const browserlessProxyCountry = process.env.BROWSERLESS_PROXY_COUNTRY?.trim() || null;
  const browserlessProxySticky = process.env.BROWSERLESS_PROXY_STICKY?.trim() || null;
  const browserlessProxyLocaleMatch = process.env.BROWSERLESS_PROXY_LOCALE_MATCH?.trim() || null;
  const parsed = parseExternalProxyServer(rawCustomProxy);

  return {
    mode,
    browserlessProxy,
    browserlessProxyCountry,
    browserlessProxySticky,
    browserlessProxyLocaleMatch,
    customProxySource,
    browserlessProxyEnvLooksCustom,
    ...parsed,
  };
}

function addProxyDiagnostics(diagnostics: Record<string, unknown>, proxy: ProxyConfig): void {
  diagnostics.browserlessProxyEnabled = Boolean(proxy.browserlessProxy || proxy.externalProxyServer);
  diagnostics.browserlessProxyMode = proxy.browserlessProxy ? "browserless" : proxy.externalProxyServer ? proxy.mode : "none";
  diagnostics.browserlessProxyCountry = proxy.browserlessProxyCountry ?? null;
  diagnostics.browserlessProxySticky = proxy.browserlessProxySticky ?? null;
  diagnostics.browserlessProxyLocaleMatch = proxy.browserlessProxyLocaleMatch ?? null;
  diagnostics.browserlessExternalProxyConfigured = Boolean(proxy.externalProxyServer);
  diagnostics.browserlessProxyAuth = Boolean(proxy.username && proxy.password);
  diagnostics.browserlessProxySource = proxy.customProxySource ?? (proxy.browserlessProxy ? "BROWSERLESS_PROXY" : null);
  diagnostics.browserlessProxyEnvLooksCustom = proxy.browserlessProxyEnvLooksCustom;
}

function buildWsEndpoint(proxy: ProxyConfig): string | null {
  let ep = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!ep) return null;
  const token = process.env.BROWSERLESS_API_TOKEN?.trim();
  if (token && !/[?&]token=/.test(ep)) ep = appendParam(ep, "token", token);

  const stealth = process.env.BROWSERLESS_STEALTH?.trim() || "true";
  if (stealth && !/[?&]stealth=/.test(ep)) ep = appendParam(ep, "stealth", stealth);

  const timeout = process.env.BROWSERLESS_TIMEOUT_MS?.trim() || "60000";
  if (timeout && !/[?&]timeout=/.test(ep)) ep = appendParam(ep, "timeout", timeout);

  if (proxy.browserlessProxy && !/[?&]proxy=/.test(ep)) ep = appendParam(ep, "proxy", proxy.browserlessProxy);
  if (proxy.browserlessProxyCountry && !/[?&]proxyCountry=/.test(ep)) {
    ep = appendParam(ep, "proxyCountry", proxy.browserlessProxyCountry);
  }
  if (proxy.browserlessProxySticky && !/[?&]proxySticky=/.test(ep)) {
    ep = appendParam(ep, "proxySticky", proxy.browserlessProxySticky);
  }
  if (proxy.browserlessProxyLocaleMatch && !/[?&]proxyLocaleMatch=/.test(ep)) {
    ep = appendParam(ep, "proxyLocaleMatch", proxy.browserlessProxyLocaleMatch);
  }
  if (proxy.externalProxyServer && proxy.mode === "external" && !/[?&]externalProxyServer=/.test(ep)) {
    ep = appendParam(ep, "externalProxyServer", proxy.externalProxyServer);
  }
  if (proxy.chromeProxyServer && proxy.mode === "chrome_arg" && !/[?&]--proxy-server=/.test(ep)) {
    ep = appendParam(ep, "--proxy-server", proxy.chromeProxyServer);
  }

  return ep;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SHOPEE_CDN_RE = /(susercontent\.com|cf\.shopee\.vn|img\.susercontent\.com)/i;

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
  const proxy = readProxyConfig();
  addProxyDiagnostics(diagnostics, proxy);
  if (!isBrowserExtractConfigured()) {
    return { ok: false, image_urls: [], status: "NOT_CONFIGURED", error: "Browser extractor chưa cấu hình.", diagnostics };
  }
  const wsEndpoint = buildWsEndpoint(proxy);
  if (!wsEndpoint) return { ok: false, image_urls: [], status: "NOT_CONFIGURED", error: "Thiếu BROWSERLESS_WS_ENDPOINT.", diagnostics };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  let stage = "connect";
  try {
    diagnostics.browserExtractionStage = "import_puppeteer";
    const mod = (await import("puppeteer-core")) as unknown as { default: { connect: (o: { browserWSEndpoint: string }) => Promise<unknown> } };
    diagnostics.browserExtractionStage = stage;
    browser = await mod.default.connect({ browserWSEndpoint: wsEndpoint });
    stage = "new_page";
    diagnostics.browserExtractionStage = stage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page: any = await browser.newPage();
    if (proxy.mode === "chrome_arg" && proxy.username && proxy.password && typeof page.authenticate === "function") {
      stage = "proxy_auth";
      diagnostics.browserExtractionStage = stage;
      await page.authenticate({ username: proxy.username, password: proxy.password });
    }
    stage = "set_headers";
    diagnostics.browserExtractionStage = stage;
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
        if (SHOPEE_CDN_RE.test(u) && (ct.includes("image") || isLikelyProductImage(u))) networkImages.add(u);
      } catch {
        /* ignore */
      }
    });

    stage = "goto";
    diagnostics.browserExtractionStage = stage;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    stage = "lazy_load";
    diagnostics.browserExtractionStage = stage;
    await sleep(3500);
    // Scroll để kích lazy-load.
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight / 2))).catch(() => {});
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(2000);

    stage = "scan_dom";
    diagnostics.browserExtractionStage = stage;
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

    const rawCandidates = Array.from(new Set([...dom.urls, ...Array.from(networkImages)].map(normalizeImageUrl).filter(Boolean)));
    const valid: string[] = [];
    const rejected: Array<{ url: string; reason: string }> = [];
    for (const c of rawCandidates) {
      if (isLikelyProductImage(c)) valid.push(c);
      else if (rejected.length < 10) rejected.push({ url: c.slice(0, 180), reason: "logo/icon/non-product hoặc không phải ảnh sản phẩm" });
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
    diagnostics.browserExtractionStage = stage;
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
