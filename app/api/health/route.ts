import { NextResponse } from "next/server";

/**
 * Health check đơn giản (Phase 1).
 * Không gọi service bên ngoài, chỉ xác nhận app đang chạy.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    app: "shopee-affiliate-agent",
    phase: 1,
  });
}
