# Grok Image Worker (cookie-based)

Worker sinh ảnh bằng **tài khoản Grok thật qua cookie** (Playwright). Chạy **NGOÀI Vercel**
(VPS / Railway / Render / Fly). App chính gọi worker này khi `IMAGE_PROVIDER=grok_gateway`.

> ⚠️ **Rủi ro:** tự động hoá tài khoản qua cookie có thể **vi phạm ToS của X/Grok** và
> dẫn tới **khoá tài khoản**. Dùng **tài khoản phụ**, nhịp chậm, và **proxy residential**.
> Worker là phần "dễ vỡ" — cookie hết hạn / UI đổi là phải chỉnh.

## Cài đặt
```bash
cd grok-worker
cp .env.example .env        # điền GROK_GATEWAY_SECRET, cookie, UA, proxy
npm install
npm run install:browser     # tải Chromium cho Playwright
node index.mjs              # hoặc: npm start
```

## Lấy cookie
1. Đăng nhập grok.com bằng tài khoản (Super) trên Chrome.
2. Dùng extension "Cookie Editor" → Export → JSON.
3. Dán JSON vào `GROK_COOKIES` (hoặc lưu `cookies.json` và trỏ `GROK_COOKIES_FILE`).
4. Copy đúng **User-Agent** của trình duyệt đó vào `GROK_USER_AGENT` (lệch UA dễ bị logout).

## Selector (quan trọng)
UI grok.com thay đổi theo thời gian. Mặc định (`textarea`, `button[type=submit]`,
`img[src^=https]`) **chỉ là khởi điểm**. Mở DevTools trên trang tạo ảnh, lấy selector
đúng của ô nhập prompt / nút gửi / ảnh kết quả rồi set:
`GROK_PROMPT_SELECTOR`, `GROK_SUBMIT_SELECTOR`, `GROK_IMAGE_SELECTOR`.

## Kết nối với app chính
Trên Vercel (app), đặt env:
```
IMAGE_PROVIDER=grok_gateway
GROK_GATEWAY_URL=https://worker-cua-ban.example.com
GROK_GATEWAY_SECRET=<trùng với worker>
GROK_GATEWAY_FALLBACK=v98   # worker lỗi/hết hạn cookie -> tự rớt về V98
```
App gọi `POST {GROK_GATEWAY_URL}/generate` (Bearer secret) và nhận `{ b64 }`.
Phần overlay tiếng Việt / upload Supabase / cache / trần chi phí vẫn do app xử lý.

## Kiểm tra nhanh
```bash
curl -X POST http://localhost:8080/generate \
  -H "Authorization: Bearer <SECRET>" -H "Content-Type: application/json" \
  -d '{"prompt":"a cozy minimalist living room, soft light, no text"}' | jq '.b64 | length'
```
Trả về độ dài chuỗi base64 > 0 là OK.

## Bảo mật
- Cookie/secret **chỉ** nằm ở worker (env của host worker). KHÔNG đưa vào app/Vercel/DB/log.
- App ↔ worker xác thực bằng `GROK_GATEWAY_SECRET`, nên chạy worker sau HTTPS.
