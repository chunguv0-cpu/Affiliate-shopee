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

const PORT = Number(process.env.PORT || 8080);
const SECRET = (process.env.GROK_GATEWAY_SECRET || "").trim();
const GROK_URL = (process.env.GROK_URL || "https://grok.com/").trim();
const USER_AGENT =
  (process.env.GROK_USER_AGENT || "").trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PROXY = (process.env.GROK_PROXY || "").trim(); // http://user:pass@host:port
const NAV_TIMEOUT = Number(process.env.GROK_NAV_TIMEOUT_MS || 60000);
const GEN_TIMEOUT = Number(process.env.GROK_GEN_TIMEOUT_MS || 90000);

// Selector — CHỈNH theo giao diện grok.com hiện tại.
const SEL_PROMPT = process.env.GROK_PROMPT_SELECTOR || 'textarea';
const SEL_SUBMIT = process.env.GROK_SUBMIT_SELECTOR || 'button[type="submit"]';
const SEL_IMAGE = process.env.GROK_IMAGE_SELECTOR || 'img[src^="https"]';

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
    ...(PROXY ? { proxy: { server: PROXY } } : {}),
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

/** Sinh 1 ảnh từ prompt. Trả { b64 } hoặc { error }. */
async function generateImage(prompt) {
  await ensureBrowser();
  const page = await context.newPage();
  try {
    page.setDefaultTimeout(NAV_TIMEOUT);
    await page.goto(GROK_URL, { waitUntil: "domcontentloaded" });

    // TODO: chỉnh các bước này theo UI Grok hiện tại.
    const promptBox = page.locator(SEL_PROMPT).first();
    await promptBox.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
    await promptBox.fill(prompt);

    // Gửi: thử nút submit, nếu không có thì Enter.
    const submit = page.locator(SEL_SUBMIT).first();
    if (await submit.count()) await submit.click().catch(() => promptBox.press("Enter"));
    else await promptBox.press("Enter");

    // Chờ ảnh kết quả xuất hiện.
    const img = page.locator(SEL_IMAGE).last();
    await img.waitFor({ state: "visible", timeout: GEN_TIMEOUT });
    const src = await img.getAttribute("src");
    if (!src) return { error: "Không tìm thấy ảnh kết quả (chỉnh GROK_IMAGE_SELECTOR)." };

    // Tải ảnh về dạng base64 (qua chính phiên đăng nhập).
    const resp = await context.request.get(src);
    if (!resp.ok()) return { error: `Tải ảnh lỗi: HTTP ${resp.status()}` };
    const buf = await resp.body();
    return { b64: Buffer.from(buf).toString("base64") };
  } catch (err) {
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
  console.log(`[grok-worker] listening on :${PORT} (proxy: ${PROXY ? "on" : "off"}, auth: ${SECRET ? "on" : "off"})`);
});
