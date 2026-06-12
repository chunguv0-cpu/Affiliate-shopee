// =============================================================================
// Grok Image Worker — sinh ảnh bằng tài khoản Grok thật qua COOKIE (Playwright).
// CHẠY NGOÀI Vercel (VPS/Railway/Render/Fly...). App gọi worker này khi
// IMAGE_PROVIDER=grok_gateway.
//
// Hợp đồng HTTP (khớp với lib/creative/image-provider.ts -> callGrokGateway):
//   GET  /health                 -> { ok, browser, queue }
//   POST /generate { prompt }     -> { b64 } | { url } | { error }
//   (Bearer GROK_GATEWAY_SECRET nếu có)
//
// CẢNH BÁO: tự động hoá tài khoản qua cookie có thể VI PHẠM ToS của X/Grok và
// dẫn tới KHOÁ TÀI KHOẢN. Dùng tài khoản phụ, nhịp chậm, có proxy residential.
// Selector của grok.com có thể đổi -> chỉnh qua biến môi trường GROK_* bên dưới.
// KHÔNG log cookie/secret.
// =============================================================================

import fs from "node:fs";
import express from "express";
import { chromium } from "playwright";

// Nạp ./.env (không cần thư viện). Chạy: cd grok-worker && node index.mjs
(function loadDotenv() {
  try {
    if (!fs.existsSync(".env")) return;
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const i = s.indexOf("=");
      if (i < 0) continue;
      const key = s.slice(0, i).trim();
      let val = s.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
})();

const PORT = Number(process.env.PORT || 8080);
const SECRET = (process.env.GROK_GATEWAY_SECRET || "").trim();
const GROK_URL = (process.env.GROK_URL || "https://grok.com/").trim();
const USER_AGENT =
  (process.env.GROK_USER_AGENT || "").trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NAV_TIMEOUT = Number(process.env.GROK_NAV_TIMEOUT_MS || 60000);
const GEN_TIMEOUT = Number(process.env.GROK_GEN_TIMEOUT_MS || 90000);

/**
 * Parse proxy về dạng Playwright cần: { server, username?, password? }.
 * Hỗ trợ: http://user:pass@host:port | user:pass:host:port | host:port:user:pass | host:port
 */
function parseProxy(raw) {
  const v = (raw || "").trim();
  if (!v) return null;
  if (/^(https?|socks5):\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const server = `${u.protocol}//${u.host}`;
      const username = u.username ? decodeURIComponent(u.username) : undefined;
      const password = u.password ? decodeURIComponent(u.password) : undefined;
      return username ? { server, username, password } : { server };
    } catch {
      return { server: v };
    }
  }
  const p = v.split(":");
  if (p.length === 2) return { server: `http://${p[0]}:${p[1]}` };
  if (p.length >= 4) {
    // host:port:user:pass  (phần 2 là số)  vs  user:pass:host:port (phần 4 là số)
    if (/^\d+$/.test(p[1])) return { server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(":") };
    if (/^\d+$/.test(p[3])) return { server: `http://${p[2]}:${p[3]}`, username: p[0], password: p[1] };
  }
  return { server: v };
}
const PROXY_CONFIG = parseProxy(process.env.GROK_PROXY);

// Selector — CHỈNH theo giao diện grok.com hiện tại.
const SEL_PROMPT = process.env.GROK_PROMPT_SELECTOR || 'textarea, [contenteditable="true"], div[role="textbox"]';
const SEL_SUBMIT = process.env.GROK_SUBMIT_SELECTOR || 'button[type="submit"], button[aria-label*="end" i], button[data-testid*="send" i]';
const MIN_IMAGE_PX = Number(process.env.GROK_MIN_IMAGE_PX || 480);
const PROMPT_PREFIX = process.env.GROK_PROMPT_PREFIX ?? "Generate an image (no text, no words in the image): ";

const COOKIE_DOMAIN = (process.env.GROK_COOKIE_DOMAIN || ".grok.com").trim();

/** Parse chuỗi cookie thô từ F12 (Network -> Request Headers -> cookie: a=1; b=2). */
function parseCookieHeader(str) {
  return str
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      if (i < 0) return null;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!name) return null;
      return { name, value, domain: COOKIE_DOMAIN, path: "/", secure: true, sameSite: "Lax" };
    })
    .filter(Boolean);
}

/**
 * Đọc cookie từ GROK_COOKIES (JSON mảng HOẶC chuỗi thô "a=1; b=2" từ F12)
 * hoặc file GROK_COOKIES_FILE.
 */
function loadCookies() {
  const raw = (process.env.GROK_COOKIES || "").trim();
  const file = (process.env.GROK_COOKIES_FILE || "").trim();
  let text = raw;
  if (!text && file && fs.existsSync(file)) text = fs.readFileSync(file, "utf8");
  if (!text) return [];

  // Thử JSON mảng (export từ Cookie-Editor).
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      return arr
        .filter((c) => c && c.name && c.value)
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || COOKIE_DOMAIN,
          path: c.path || "/",
          httpOnly: !!c.httpOnly,
          secure: c.secure !== false,
          sameSite: c.sameSite || "Lax",
        }));
    }
  } catch {
    /* không phải JSON -> coi như chuỗi thô F12 */
  }

  // Chuỗi cookie thô từ F12 (Network tab).
  return parseCookieHeader(text);
}

let browser = null;
let context = null;

async function ensureBrowser() {
  if (browser && context) return;
  browser = await chromium.launch({
    headless: true,
    ...(PROXY_CONFIG ? { proxy: PROXY_CONFIG } : {}),
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 } });
  const cookies = loadCookies();
  if (cookies.length > 0) await context.addCookies(cookies);
}

// Hàng đợi đơn giản: xử lý TỪNG request (1 trình duyệt, tránh đụng nhau).
let chain = Promise.resolve();
let queued = 0;
function enqueue(task) {
  queued += 1;
  const run = chain.then(task, task).finally(() => {
    queued -= 1;
  });
  chain = run.catch(() => {});
  return run;
}

/** Lưu ảnh chụp + thông tin trang khi lỗi để chẩn đoán (KHÔNG log cookie). */
async function dumpDebug(page, label) {
  let url = "";
  let title = "";
  try {
    url = page.url();
    title = await page.title().catch(() => "");
    await page.screenshot({ path: "last-error.png", fullPage: false }).catch(() => {});
    fs.writeFileSync("last-error.html", await page.content().catch(() => ""));
  } catch {
    /* ignore */
  }
  console.error(`[grok-worker] LỖI: ${label} | url=${url} | title=${title} | đã lưu last-error.png + last-error.html`);
  return { url, title };
}

/** Sinh 1 ảnh từ prompt. Trả { b64 } hoặc { error }. */
async function generateImage(prompt) {
  await ensureBrowser();
  const page = await context.newPage();
  try {
    page.setDefaultTimeout(NAV_TIMEOUT);
    await page.goto(GROK_URL, { waitUntil: "domcontentloaded" });

    // Tìm ô nhập: textarea/input HOẶC contenteditable.
    const box = page.locator(SEL_PROMPT).first();
    try {
      await box.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
    } catch {
      const d = await dumpDebug(page, "Không thấy ô nhập prompt (sai GROK_PROMPT_SELECTOR, hoặc bị Cloudflare/đăng nhập)");
      return { error: `Không thấy ô nhập. Trang: ${d.title || d.url}. Xem last-error.png.` };
    }

    // Ghi nhớ ảnh hiện có để phát hiện ảnh MỚI sau khi gửi.
    const before = await page.evaluate(() => Array.from(document.images).map((i) => i.currentSrc || i.src));

    // Nhập prompt (fill cho textarea/input, gõ phím cho contenteditable).
    const full = `${PROMPT_PREFIX}${prompt}`;
    const tag = await box.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "textarea" || tag === "input") {
      await box.fill(full);
    } else {
      await box.click();
      await page.keyboard.type(full, { delay: 5 });
    }

    // Gửi: nút submit nếu có, không thì Enter.
    const submit = page.locator(SEL_SUBMIT).first();
    if (await submit.count().catch(() => 0)) await submit.click().catch(() => box.press("Enter"));
    else await box.press("Enter");

    // Chờ 1 ảnh MỚI, đủ lớn xuất hiện (ảnh sinh ra, không phải logo/avatar/icon).
    let src = null;
    try {
      const handle = await page.waitForFunction(
        ({ prev, minPx }) => {
          const found = Array.from(document.images)
            .filter((i) => (i.naturalWidth >= minPx || i.width >= minPx * 0.8) && i.src && i.src.startsWith("http"))
            .map((i) => i.currentSrc || i.src)
            .filter((s) => !prev.includes(s));
          return found[0] || null;
        },
        { prev: before, minPx: MIN_IMAGE_PX },
        { timeout: GEN_TIMEOUT, polling: 1000 },
      );
      src = await handle.jsonValue();
    } catch {
      src = null;
    }
    if (!src) {
      const d = await dumpDebug(page, "Không thấy ảnh mới đủ lớn (Grok có thể trả text, hoặc cần chỉnh prompt/selector)");
      return { error: `Grok chưa trả ảnh. Trang: ${d.title || d.url}. Xem last-error.png.` };
    }

    // Tải ảnh về dạng base64 (qua chính phiên đăng nhập).
    const resp = await context.request.get(src);
    if (!resp.ok()) return { error: `Tải ảnh lỗi: HTTP ${resp.status()}` };
    const buf = await resp.body();
    return { b64: Buffer.from(buf).toString("base64") };
  } catch (err) {
    await dumpDebug(page, "Exception khi tạo ảnh").catch(() => {});
    return { error: (err && err.message ? String(err.message) : "Grok worker lỗi").slice(0, 300) };
  } finally {
    await page.close().catch(() => {});
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));

function checkAuth(req) {
  if (!SECRET) return true; // không đặt secret = chấp nhận (chỉ nên dùng nội bộ)
  return req.headers.authorization === `Bearer ${SECRET}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, browser: !!browser, queue: queued });
});

app.post("/generate", async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ error: "Unauthorized" });
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "Thiếu prompt." });
  try {
    const out = await enqueue(() => generateImage(prompt));
    if (out.error) return res.status(502).json(out);
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: (err && err.message ? String(err.message) : "Worker lỗi").slice(0, 300) });
  }
});

app.listen(PORT, () => {
  // KHÔNG log cookie/secret.
  console.log(`[grok-worker] listening on :${PORT} (proxy: ${PROXY_CONFIG ? "on" : "off"}, auth: ${SECRET ? "on" : "off"})`);
});
