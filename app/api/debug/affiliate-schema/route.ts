import { NextResponse } from "next/server";

import { callShopeeAffiliateGraphql } from "@/lib/shopee/affiliate-api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug: HỎI THẲNG API Affiliate Shopee xem có trường ẢNH nào (gallery) không.
 * 1) GraphQL introspection -> liệt kê mọi type có field chứa "image".
 * 2) Nếu introspection bị tắt -> thử productOfferV2 với các field ảnh ứng viên, đọc lỗi để biết field nào tồn tại.
 * GET /api/debug/affiliate-schema?account_id=...  (production cần Bearer CRON_SECRET)
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const sp = new URL(request.url).searchParams;
  let accountId = sp.get("account_id");

  try {
    const supabase = createSupabaseAdminClient();
    if (!accountId) {
      const { data: def } = await supabase
        .from("shopee_accounts")
        .select("id")
        .eq("is_default", true)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
      accountId = (def?.id as string | undefined) ?? null;
      if (!accountId) {
        const { data: any1 } = await supabase.from("shopee_accounts").select("id").eq("status", "ACTIVE").limit(1).maybeSingle();
        accountId = (any1?.id as string | undefined) ?? null;
      }
    }
    if (!accountId) return NextResponse.json({ ok: false, error: "Không có tài khoản Shopee ACTIVE. Thêm ?account_id=" }, { status: 400 });

    const { data } = await supabase
      .from("shopee_accounts")
      .select("app_id, app_secret, api_endpoint")
      .eq("id", accountId)
      .single();
    if (!data) return NextResponse.json({ ok: false, error: "Không tìm thấy tài khoản." }, { status: 404 });
    const cred = { app_id: data.app_id as string, app_secret: data.app_secret as string, api_endpoint: (data.api_endpoint as string | null) ?? null };

    // 1) Introspection toàn schema -> lọc type có field tên chứa "image".
    const introspection = await callShopeeAffiliateGraphql(
      cred,
      `{ __schema { types { name fields { name } } } }`,
    );

    let imageFieldsByType: Array<{ type: string; imageFields: string[] }> | null = null;
    if (introspection.ok && introspection.data) {
      const schema = (introspection.data as { __schema?: { types?: Array<{ name: string; fields: Array<{ name: string }> | null }> } }).__schema;
      const types = Array.isArray(schema?.types) ? schema!.types : [];
      imageFieldsByType = types
        .map((t) => ({
          type: t.name,
          imageFields: (t.fields ?? []).map((f) => f.name).filter((n) => /image|photo|gallery|img/i.test(n)),
        }))
        .filter((t) => t.imageFields.length > 0);
    }

    // 2) Nếu introspection không có dữ liệu -> thử từng field ảnh ứng viên trong productOfferV2.
    let candidateProbe: Record<string, boolean> | null = null;
    if (!imageFieldsByType) {
      const candidates = ["imageUrl", "images", "imageList", "imageUrlList", "productImages", "itemImages", "image"];
      candidateProbe = {};
      for (const field of candidates) {
        const q = `{ productOfferV2(keyword: "test", limit: 1, page: 1) { nodes { ${field} } } }`;
        const r = await callShopeeAffiliateGraphql(cred, q);
        // ok hoặc lỗi KHÔNG phải "field không tồn tại" -> field tồn tại.
        const errStr = typeof r.error === "string" ? r.error.toLowerCase() : JSON.stringify(r.raw ?? "").toLowerCase();
        const fieldMissing = /cannot query field|unknown field|field .* doesn|no field|undefined field|not exist/i.test(errStr);
        candidateProbe[field] = r.ok || !fieldMissing;
      }
    }

    return NextResponse.json({
      ok: true,
      account_id: accountId,
      introspection_enabled: introspection.ok && !!imageFieldsByType,
      // Các type có field ảnh (nếu có "images"/"gallery" -> dùng được full kho ảnh).
      imageFieldsByType,
      // Nếu introspection tắt: field nào productOfferV2 chấp nhận (true = tồn tại).
      productOfferV2_imageFields_probe: candidateProbe,
      introspection_error: introspection.ok ? null : introspection.error,
      hint: "Nếu thấy field 'images'/'imageList'/'gallery' -> báo tôi tên chính xác, tôi sẽ lấy full ảnh qua API. Nếu chỉ có 'imageUrl' -> API affiliate chỉ cho 1 ảnh.",
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: m }, { status: 500 });
  }
}
