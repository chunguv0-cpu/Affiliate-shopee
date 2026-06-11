import { NextResponse } from "next/server";

import { searchProductOffers } from "@/lib/shopee/affiliate-api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug Shopee Affiliate API: GET /api/debug/affiliate-api?account_id=...&keyword=...&limit=5
 * Trả về offers (5 cái đầu) + raw để chỉnh field/ký nếu Shopee báo lỗi.
 * Production yêu cầu Bearer CRON_SECRET. KHÔNG lộ secret.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const sp = new URL(request.url).searchParams;
  const accountId = sp.get("account_id");
  const keyword = sp.get("keyword") || "máy xay cầm tay";
  const limit = parseInt(sp.get("limit") || "5", 10) || 5;
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Thiếu ?account_id= (lấy id ở trang Tài khoản Shopee)." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("shopee_accounts")
      .select("app_id, app_secret, api_endpoint, status")
      .eq("id", accountId)
      .single();
    if (!data) return NextResponse.json({ ok: false, error: "Không tìm thấy tài khoản." }, { status: 404 });

    const res = await searchProductOffers(
      { app_id: data.app_id as string, app_secret: data.app_secret as string, api_endpoint: (data.api_endpoint as string | null) ?? null },
      { keyword, limit },
    );
    return NextResponse.json({
      ok: res.ok,
      keyword,
      count: res.offers.length,
      offers: res.offers.slice(0, 5),
      error: res.error ?? null,
      raw: res.raw,
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: m }, { status: 500 });
  }
}
