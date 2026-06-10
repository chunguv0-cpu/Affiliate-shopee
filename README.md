# Shopee Affiliate Auto Agent

Hệ thống tự động hóa tiếp thị liên kết (affiliate) cho Shopee: quản lý sản phẩm,
sinh nội dung (caption) bằng AI, lên lịch và tự động đăng bài lên Facebook Page.

> ⚠️ **Trạng thái hiện tại: Phase 1 — Nền tảng.**
> Mới dựng khung project, database schema và giao diện dashboard. Chưa có CRUD
> thật, chưa gọi AI/Facebook/Cron. Các số liệu trên dashboard là dữ liệu mẫu.

---

## 1. Mô tả ứng dụng

Ứng dụng giúp người làm affiliate Shopee:

- Quản lý danh sách sản phẩm affiliate.
- Sinh caption quảng cáo bằng AI (V98 / OpenAI / Mock).
- Duyệt nội dung và lên lịch đăng.
- Tự động đăng bài lên Facebook Page và ghi nhật ký.

## 2. Stack công nghệ

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS v4**
- **ESLint**
- **Supabase** (PostgreSQL) — qua `@supabase/supabase-js`

## 3. Cài đặt local

Yêu cầu: Node.js >= 18.18 (khuyến nghị Node 20+).

```bash
npm install
```

## 4. Tạo file `.env.local`

Sao chép từ `.env.example` rồi điền giá trị thật:

```bash
# macOS / Linux
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local
```

Các biến quan trọng:

| Biến | Mô tả | Phạm vi |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` \| `v98` \| `openai` | server |
| `NEXT_PUBLIC_SUPABASE_URL` | URL dự án Supabase | public |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key | **server-only** |
| `V98_API_KEY` / `OPENAI_API_KEY` | Khóa AI | **server-only** |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Token Facebook | **server-only** |
| `CRON_SECRET` | Bí mật bảo vệ cron | **server-only** |

> 🔐 Tuyệt đối **không** commit `.env.local` và **không** để lộ các khóa nhạy
> cảm ra phía client.

## 5. Chạy `schema.sql` trong Supabase

1. Mở dự án Supabase → **SQL Editor**.
2. Mở file [`supabase/schema.sql`](supabase/schema.sql), copy toàn bộ nội dung.
3. Dán vào SQL Editor và bấm **Run**.

Schema sẽ tạo extension `pgcrypto`, các bảng, index, trigger `updated_at` và
các check constraint cho trạng thái.

## 6. Chạy môi trường phát triển

```bash
npm run dev
```

Mở http://localhost:3000 → tự động chuyển hướng tới `/dashboard`.

## 7. Build production

```bash
npm run build
npm start
```

## 8. Cron tự động đăng (Phase 7)

Route cron: `GET /api/cron/publish-due-posts` — mỗi lần chạy sẽ tìm **tối đa 1**
bài đến hạn (`status=READY`, `should_publish=true`, `ai_score>=80`,
`scheduled_at <= now()`) và tự đăng lên Facebook Page.

### Cấu hình `CRON_SECRET`

- Tạo một chuỗi bí mật ngẫu nhiên, dài (>= 32 ký tự). Ví dụ tạo bằng PowerShell:
  ```powershell
  [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
  ```
- Đặt vào `.env.local`: `CRON_SECRET=<chuỗi vừa tạo>`.
- Khi deploy: đặt `CRON_SECRET` trong **Vercel → Settings → Environment Variables**.
  Vercel Cron sẽ tự gửi header `Authorization: Bearer <CRON_SECRET>`.

### Test cron ở local

PowerShell:
```powershell
$headers = @{ Authorization = "Bearer YOUR_CRON_SECRET" }
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/cron/publish-due-posts" `
  -Method GET `
  -Headers $headers
```

curl:
```bash
curl -X GET http://localhost:3000/api/cron/publish-due-posts ^
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

- Sai/thiếu secret → HTTP 401 `{ "ok": false, "error": "Unauthorized" }`.
- Không có bài đến hạn → `{ "ok": true, "processed": 0, "message": "Không có bài đến hạn." }`.
- Có bài đến hạn → `{ "ok": true, "processed": 1, "result": { ... } }`.

### Lịch chạy trên Vercel

File [`vercel.json`](vercel.json) khai báo chạy **1 lần/ngày** lúc 01:00 UTC
(`"schedule": "0 1 * * *"`).

> ⚠️ Gói **Hobby (free)** của Vercel chỉ cho phép cron **tối đa 1 lần/ngày** — lịch
> dày hơn (vd `*/30 * * * *`) sẽ **fail khi deploy**. Muốn chạy mỗi 30 phút phải
> nâng gói **Pro** rồi đổi `schedule` thành `*/30 * * * *`. Bạn vẫn có thể gọi cron
> thủ công bất cứ lúc nào bằng header `Authorization: Bearer <CRON_SECRET>`.

## 9. Lưu ý production (Phase 8)

- **KHÔNG commit `.env.local`.** File này đã được `.gitignore`. Chỉ `.env.example`
  (toàn placeholder) được đưa lên repo.
- **Khóa nhạy cảm chỉ dùng server-side:** `FACEBOOK_PAGE_ACCESS_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`, `V98_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`.
  Không bao giờ để các khóa này lộ ra client (không có tiền tố `NEXT_PUBLIC_`).
- **Nếu token từng bị lộ → phải tạo lại (rotate) ngay** trong Facebook/Supabase,
  rồi cập nhật `.env.local` và Vercel Environment Variables.
- **Chống đăng trùng:** trước khi gọi Facebook, hệ thống "claim" bài bằng cách
  chuyển `READY → PUBLISHING` một cách atomic. Bài đang `PUBLISHING` sẽ không bị
  đăng lần nữa bởi luồng thủ công hay cron.
- **Cron chỉ xử lý tối đa 1 bài/lần** để tránh spam. Nếu nhiều bài đến hạn, chúng
  được đăng dần qua các lần cron (mặc định 1 lần/ngày trên gói Hobby).
- **Thử lại bài lỗi:** mở `/dashboard/posts`, bài `FAILED` có nút **🔄 Thử lại**
  để đưa về `READY` (xóa `error_log`), sau đó đăng lại thủ công hoặc đặt lịch.
- **Migration:** nếu DB đã tạo trước Phase 8, chạy
  [`supabase/migrations/add_publishing_status.sql`](supabase/migrations/add_publishing_status.sql)
  trong Supabase SQL Editor để check constraint chấp nhận `PUBLISHING`.
- **Test cron local:** xem mục 8.

## 9b. Nhập link Affiliate hàng loạt (`/dashboard/import-products`)

- **Mỗi dòng một link** affiliate Shopee đã chuyển đổi (không cần điền CSV/tên sản phẩm).
- Link phải là **link đã chuyển đổi từ tài khoản Shopee Affiliate** (s.shopee.vn / shope.ee / shopee.vn).
- **Nên gắn sub_id trước khi chuyển link** để theo dõi hoa hồng (app cũng tự sinh sub_id nội bộ).
- App chỉ **enrich metadata công khai** (Open Graph / `<title>`) bằng `fetch` server-side
  — KHÔNG login, KHÔNG cookie, KHÔNG headless browser. Nếu Shopee chặn bot thì metadata
  có thể thiếu; khi đó AI suy luận từ link và đặt **confidence thấp** (đánh dấu “cần kiểm tra lại”).
- AI tự điền `product_name`, `price_note`, `target_customer`, `product_angle`. Sản phẩm import
  có `link_status=READY`, `status=ACTIVE`; **không** tự tạo caption/chiến dịch.
- Giới hạn **tối đa 20 link/lần**. Nếu AI confidence thấp, hãy mở `/dashboard/products` kiểm tra/sửa lại.

## 9c. Import báo cáo Affiliate (Analytics — `/dashboard/analytics`)

- **Xuất báo cáo** từ Shopee Affiliate (file/CSV hiệu quả theo sub_id).
- Vào `/dashboard/analytics/import` → **dán CSV** vào ô → Preview → Import. App nhận diện
  linh hoạt tên cột: `sub_id`, `affiliate_link/link`, `clicks/click`, `orders/đơn hàng`,
  `commission/hoa hồng`, `revenue/doanh thu`, `date/ngày`.
- App đọc **click, đơn, hoa hồng, doanh thu** và map về sản phẩm/bài đăng theo
  `sub_id` (hoặc `affiliate_link`).
- **Nên gắn sub_id ngay từ lúc tạo link affiliate** để map chính xác về sản phẩm/chiến dịch/bài đăng.
- Nếu báo cáo **không có sub_id**, vẫn import được nhưng chỉ xem được số liệu tổng quát
  (khó map về bài đăng cụ thể).
- Chỉ số: tổng clicks/đơn/hoa hồng, **conversion rate** (orders/clicks), **EPC** (hoa hồng/click);
  bảng theo sub_id / sản phẩm / bài đăng + "Nhận xét nhanh" theo rule.
- KHÔNG kết nối Shopee API / KHÔNG scrape — chỉ nhập thủ công.

## 9d. AI Weekly Campaign Planner (`/dashboard/ai-planner`)

- AI phân tích **sản phẩm READY**, **bài đã đăng 30 ngày**, **báo cáo affiliate (sub_id)**
  và **campaign cũ** để đề xuất kế hoạch chiến dịch cho **tuần này**.
- **Cách tạo:** vào *Gợi ý AI* → chọn Tuần bắt đầu/kết thúc, **Mục tiêu**, tệp khách, ghi chú →
  *Tạo gợi ý chiến dịch* → mở trang chi tiết để xem.
- **Ý nghĩa mục tiêu:**
  - `clicks` — ưu tiên kéo click (hook mạnh, sản phẩm nhu cầu cao).
  - `orders` — ưu tiên chuyển đổi thành đơn.
  - `commission` — ưu tiên sản phẩm hoa hồng cao (vẫn cần có khả năng click).
  - `engagement` — ưu tiên câu hỏi/hook tăng tương tác hơn bán trực diện.
  - `balanced` — cân bằng các yếu tố.
- **Chỉ gợi ý — chưa tự tạo campaign.** Bạn chỉ **Duyệt / Từ chối**; việc tạo campaign thật vẫn làm thủ công.
- Muốn gợi ý chính xác hơn: **import báo cáo affiliate có sub_id** (mục 9c). Dữ liệu ít → AI tạo "kế hoạch test".

## 9e. AI Market Research Agent (Phase 13.1)

AI có thể **nghiên cứu thị trường bên ngoài** (Search API công khai) trước khi lập kế hoạch tuần.

- **ENV** (server-side): `SEARCH_PROVIDER=mock|tavily|google_cse` (mặc định `mock`).
  - `tavily`: thêm `TAVILY_API_KEY`.
  - `google_cse`: thêm `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX`.
  - Thiếu key → tự fallback `mock`, app không crash.
- **Chỉ dùng nguồn công khai** qua Search API — KHÔNG scrape, KHÔNG cookie, KHÔNG login Shopee, KHÔNG headless browser.
- **Test search:** `/dashboard/settings` → "Kiểm tra Search" (hoặc `POST /api/research/test`). Không hiển thị API key.
- **Chạy research:** trong *Gợi ý AI*, tick **"Cho AI nghiên cứu thị trường trước khi lập kế hoạch"** rồi tạo gợi ý.
  Hệ thống: sinh query → search (≤15 query × 5 kết quả) → lưu nguồn → AI tóm tắt insight → đưa vào kế hoạch.
- **AI plan dựa trên:** dữ liệu nội bộ + affiliate reports + research ngoài; bổ sung *campaign concept*,
  *interaction plan*, *creative directions*. Vẫn **cần người dùng Duyệt** trước khi tạo campaign/đăng bài.
- Lưu ý: trên gói Vercel Hobby, function có giới hạn thời gian — nếu dùng provider thật + nhiều query có thể chậm; `mock` thì tức thời.

## 9f. AI Strategic Campaign Brain (Phase 13.2)

AI Planner đã nâng cấp thành **chiến lược bán hàng** thay vì tóm tắt chung chung.

- **Quy trình 4 bước:** Hiểu thị trường (Tavily) → Chẩn đoán dữ liệu nội bộ → Chiến lược theo mục tiêu → Kế hoạch hành động chi tiết.
- **Dữ liệu dùng:** products READY + affiliate_reports (30 ngày) + nghiên cứu Tavily. Nếu dữ liệu nội bộ ít → AI nói rõ "kế hoạch test có kiểm soát" + nêu giả thuyết + cách đo sau 7 ngày (không kết luận thắng/thua).
- **Mục tiêu "Tăng đơn hàng"** → AI chuyển sang **conversion mode**: phân biệt sản phẩm kéo click vs dễ ra đơn vs hoa hồng cao cần warming vs không nên ưu tiên; hook tăng ý định mua; CTA chốt deal; lịch phục vụ chuyển đổi.
- **Form** có thêm: *Mục tiêu chi tiết* (ưu tiên của bạn), *Mức độ cụ thể* (Nhanh/Chi tiết/Rất chi tiết), *Chế độ chiến lược* (Test an toàn / Đẩy SP thắng / Tìm SP mới / Tăng đơn / Tăng hoa hồng / Kéo tương tác).
- **Output** (xem trang chi tiết): executive summary, chẩn đoán thị trường (insight có evidence), chẩn đoán dữ liệu nội bộ, bảng quyết định sản phẩm (PUSH/TEST/HOLD/AVOID), **sản phẩm nên đi tìm link** (kèm từ khóa search Shopee), kế hoạch 7 ngày (hook/CTA/comment/why), engagement system, creative brief, measurement plan, rủi ro, next actions.
- **products_to_source** là gợi ý để bạn **tự tìm link affiliate** (AI không bịa link/giá); chưa dùng được trong campaign cho đến khi bạn import link.
- **Quality checker** đánh dấu kế hoạch còn chung chung (thiếu hook/CTA/reason/measurement…) bằng box cảnh báo.
- Vẫn **chỉ gợi ý** — cần bạn Duyệt; không tự tạo campaign/đăng bài.

## 10. Deploy lên Vercel

Trước khi deploy, chạy `npm run check:env` và `npm run build` để chắc chắn không
thiếu env và build sạch. Xem thêm [`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md).

1. **Đẩy code lên GitHub** (đảm bảo `.env.local` KHÔNG được commit — đã `.gitignore`).
   ```bash
   git add -A && git commit -m "..." && git push
   ```
2. **Import repo vào Vercel**: vercel.com → *Add New → Project* → chọn repo.
3. **Add Environment Variables** trong *Project Settings → Environment Variables*
   (Production). Set đủ các biến trong bảng ở [`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md)
   mục 2. **Không** upload `.env.local`.
4. **Deploy** production (Vercel tự build `next build`).
5. **Kiểm tra Cron Jobs**: Project → *Settings → Cron Jobs* — phải thấy
   `/api/cron/publish-due-posts` chạy 1 lần/ngày (khai báo trong `vercel.json`).
6. **Function Logs** nếu cron lỗi: Project → *Logs* (hoặc *Deployments → Functions*)
   để xem phản hồi của route cron.
7. **KHÔNG dùng `.env.local` trên Vercel** — mọi biến phải đặt qua Environment Variables.

> Gợi ý: lần đầu nên để `AI_PROVIDER=mock` để kiểm tra toàn luồng, sau đó mới đổi
> sang `v98`/`openai`.

## 11. Roadmap

| Phase | Nội dung |
| --- | --- |
| **Phase 1** | Nền tảng app (khung project, schema, dashboard) ✅ |
| **Phase 2** | CRUD sản phẩm |
| **Phase 3** | AI Provider: V98 / OpenAI / Mock |
| **Phase 4** | Sinh caption bằng AI |
| **Phase 5** | Lịch đăng bài |
| **Phase 6** | Đăng Facebook thủ công |
| **Phase 7** | Vercel Cron tự động đăng |
| **Phase 8** | Logs, retry, chống lỗi |

## Cấu trúc thư mục

```
app/
  api/health/route.ts      # health check
  dashboard/
    layout.tsx             # khung dashboard
    page.tsx               # tổng quan + 4 stat card
    products/page.tsx      # quản lý sản phẩm
    posts/page.tsx         # bài đăng AI
    calendar/page.tsx      # lịch đăng
    settings/page.tsx      # cấu hình (đọc AI provider server-side)
    logs/page.tsx          # nhật ký
components/dashboard/       # Shell, Sidebar, Topbar, StatCard, ...
lib/
  supabase/server.ts       # createSupabaseAdminClient() (server-only)
  ai/client.ts             # placeholder AI + mock caption
  facebook/client.ts       # placeholder Facebook + mock publish
  utils/env.ts             # getRequiredEnv / getOptionalEnv
supabase/schema.sql        # database schema
```
