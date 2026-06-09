# ✅ Production Checklist — Shopee Affiliate Auto Agent

Checklist chuẩn bị trước và sau khi deploy lên Vercel.

---

## 1. Việc cần làm TRƯỚC khi deploy

- [ ] **Rotate Facebook Page Access Token** nếu token từng bị lộ (chat, ảnh, commit...).
- [ ] Kiểm tra **Supabase URL** và **service role key** còn đúng (Supabase → Settings → API).
- [ ] Kiểm tra bảng `generated_posts` đã có status **`PUBLISHING`** trong check constraint.
      Nếu chưa: chạy [`supabase/migrations/add_publishing_status.sql`](supabase/migrations/add_publishing_status.sql)
      trong Supabase SQL Editor.
- [ ] `npm run check:env` → không còn dòng **MISSING**.
- [ ] `npm run build` → pass, không có TypeScript/ESLint error.
- [ ] **Test publish thủ công** ở local: tạo bài AI → bấm "Đăng ngay" → kiểm tra Fanpage.
- [ ] **Test cron** ở local (xem mục 5 README — gọi route bằng `Authorization: Bearer <CRON_SECRET>`).
- [ ] **Test logs**: `/dashboard/logs` hiển thị đúng SUCCESS/FAILED và filter hoạt động.

## 2. Biến môi trường CẦN set trên Vercel

> Project Settings → **Environment Variables** (Production). KHÔNG dùng `.env.local` trên Vercel.

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `AI_PROVIDER` | ✅ | `mock` \| `v98` \| `openai` |
| `V98_API_KEY` | khi `AI_PROVIDER=v98` | server-side |
| `V98_BASE_URL` | khi `AI_PROVIDER=v98` | endpoint OpenAI-compatible |
| `V98_MODEL` | khi `AI_PROVIDER=v98` | tên model |
| `OPENAI_API_KEY` | khi `AI_PROVIDER=openai` | server-side |
| `OPENAI_MODEL` | khi `AI_PROVIDER=openai` | vd `gpt-4o-mini` |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | có thể public |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **server-side only** |
| `FACEBOOK_PAGE_ID` | ✅ | |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | ✅ | **server-side only** |
| `CRON_SECRET` | ✅ | chuỗi ngẫu nhiên dài (≥ 32 ký tự) |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL production, vd `https://your-app.vercel.app` |

## 3. Env production khuyến nghị

- Lần deploy đầu: đặt **`AI_PROVIDER=mock`** để kiểm tra toàn bộ luồng mà không tốn API/không phụ thuộc V98/OpenAI.
- Khi mọi thứ ổn định, đổi sang **`AI_PROVIDER=v98`** (hoặc `openai`) và set đủ key tương ứng.

## 4. Cron production

- [`vercel.json`](vercel.json) có `"path": "/api/cron/publish-due-posts"`.
- `schedule` mặc định **1 lần/ngày** (`0 1 * * *`) để hợp với giới hạn gói Hobby.
  ⚠️ Gói Hobby chỉ cho cron tối đa 1 lần/ngày; lịch dày hơn (vd `*/30 * * * *`) sẽ
  **fail khi deploy**. Cần chạy 30 phút/lần thì nâng gói **Pro** rồi đổi schedule.
- Cron **chỉ xử lý tối đa 1 bài/lần** để tránh spam Fanpage.
- Route yêu cầu `Authorization: Bearer <CRON_SECRET>`. Vercel Cron tự gửi header này khi `CRON_SECRET` đã set.

## 5. Test SAU khi deploy

- [ ] Mở `/dashboard` — kiểm tra số liệu hiển thị.
- [ ] Thêm 1 sản phẩm ở `/dashboard/products`.
- [ ] Bấm **Tạo bài AI** → bài xuất hiện ở `/dashboard/posts`.
- [ ] **Đặt lịch trong quá khứ** (thời điểm <= hiện tại) cho bài READY.
- [ ] Gọi cron route thủ công:
      ```bash
      curl -X GET https://<your-app>.vercel.app/api/cron/publish-due-posts ^
        -H "Authorization: Bearer <CRON_SECRET>"
      ```
- [ ] Kiểm tra bài đã lên **Fanpage**.
- [ ] Kiểm tra `/dashboard/logs` có log `PUBLISH_FACEBOOK_CRON / SUCCESS`.

## 6. Cảnh báo bảo mật

- ❌ **Không** gửi token/key cho người khác.
- ❌ **Không** chụp ảnh / chia sẻ nội dung `.env.local`.
- 🔁 Nếu token/key bị lộ → **tạo lại (rotate) ngay** rồi cập nhật trên Vercel.
- ❌ **Không** auto đăng lên Facebook **cá nhân** — chỉ đăng lên **Fanpage** đã cấu hình.
- 🔒 `SUPABASE_SERVICE_ROLE_KEY`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `V98_API_KEY`,
  `OPENAI_API_KEY`, `CRON_SECRET` **chỉ dùng server-side**, không bao giờ gắn tiền tố `NEXT_PUBLIC_`.
