import { NextResponse } from "next/server";

import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-capture-secret",
  };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * Nhận ảnh sản phẩm do bookmarklet (chạy trong trình duyệt user) gửi về.
 * Dùng text/plain body để tránh CORS preflight phức tạp.
 */
export async function POST(request: Request) {
  // Cho phép secret qua header HOẶC trong body (bookmarklet).
  const headerSecret = request.headers.get("x-capture-secret");
  const required = process.env.PRODUCT_CAPTURE_SECRET?.trim();

  let payload: Record<string, unknown> = {};
  try {
    const text = await request.text();
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return json({ ok: false, error: "Body không phải JSON hợp lệ." }, 400);
  }

  const bodySecret = typeof payload.capture_secret === "string" ? payload.capture_secret : null;
  if (!required) {
    return json({ ok: false, error: "Server chưa cấu hình PRODUCT_CAPTURE_SECRET." }, 500);
  }
  if (headerSecret !== required && bodySecret !== required) {
    return json({ ok: false, error: "Sai capture secret." }, 401);
  }

  const productId = typeof payload.product_id === "string" && payload.product_id ? payload.product_id : null;
  const affiliateLink = typeof payload.affiliate_link === "string" && payload.affiliate_link ? payload.affiliate_link : null;
  if (!productId && !affiliateLink) {
    return json({ ok: false, error: "Cần product_id hoặc affiliate_link." }, 400);
  }

  const rawImages = Array.isArray(payload.images) ? (payload.images as unknown[]) : [];
  const valid = Array.from(
    new Set(rawImages.filter((x): x is string => typeof x === "string").map(normalizeImageUrl).filter(isLikelyProductImage)),
  ).slice(0, 8);

  if (valid.length === 0) {
    return json({ ok: false, error: "Không có ảnh sản phẩm hợp lệ (chỉ thấy logo/icon hoặc URL lạ)." }, 422);
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "DB error";
    return json({ ok: false, error: `Không kết nối DB: ${m}` }, 500);
  }

  // Tìm product theo id hoặc affiliate_link.
  let targetId = productId;
  if (!targetId && affiliateLink) {
    const { data } = await supabase.from("products").select("id").eq("affiliate_link", affiliateLink).limit(1);
    targetId = (data?.[0]?.id as string | undefined) ?? null;
  }
  if (!targetId) {
    return json({ ok: false, error: "Không tìm thấy sản phẩm khớp (product_id/affiliate_link)." }, 404);
  }

  const note = typeof payload.title === "string" && payload.title ? `Captured: ${payload.title}`.slice(0, 300) : "Captured from user's browser";
  const method = typeof payload.source === "string" && payload.source ? payload.source : "bookmarklet";

  const { error } = await supabase
    .from("products")
    .update({
      image_url: valid[0],
      source_product_images: valid,
      source_capture_status: "CAPTURED",
      source_capture_method: method,
      source_capture_note: note,
      source_captured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);
  if (error) return json({ ok: false, error: `Lưu thất bại: ${error.message}` }, 500);

  return json({ ok: true, saved: valid.length, product_id: targetId });
}
