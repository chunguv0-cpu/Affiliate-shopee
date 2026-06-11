import { NextResponse } from "next/server";

import {
  fetchProductDataFromProvider,
  getProductDataProviderConfig,
} from "@/lib/product/product-data-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Debug: GET /api/debug/product-data-provider
 *   - không có ?url= : chỉ trả config (an toàn, không lộ secret).
 *   - có ?url=... (hoặc &affiliate_link=) : gọi provider thật để test.
 * Production yêu cầu Bearer CRON_SECRET.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const cfg = getProductDataProviderConfig();
  const sp = new URL(request.url).searchParams;
  const url = sp.get("url") || sp.get("affiliate_link");
  if (!url) {
    return NextResponse.json({ config: cfg });
  }
  const result = await fetchProductDataFromProvider({
    affiliate_link: url,
    resolved_url: sp.get("resolved_url"),
    shop_id: sp.get("shop_id"),
    item_id: sp.get("item_id"),
  });
  return NextResponse.json({ config: cfg, result });
}
