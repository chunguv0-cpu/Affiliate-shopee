"use server";

import { revalidatePath } from "next/cache";

import { deriveLinkStatus, generateSubId } from "@/lib/affiliate";
import { searchProductOffers, type ShopeeApiCredential } from "@/lib/shopee/affiliate-api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { ShopeeAccount } from "@/lib/types";

const PATH = "/dashboard/accounts";

export type SimpleResult = { ok: true } | { ok: false; error: string };
export type AccountsResult = { ok: true; accounts: ShopeeAccount[] } | { ok: false; error: string };

const ACCOUNT_COLS = "id, label, app_id, api_endpoint, is_default, status, note, last_used_at, created_at, updated_at";

function text(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Danh sách tài khoản — KHÔNG trả app_secret. */
export async function getShopeeAccounts(): Promise<AccountsResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("shopee_accounts")
      .select(ACCOUNT_COLS)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: `Không tải được tài khoản: ${error.message}` };
    return { ok: true, accounts: (data ?? []) as ShopeeAccount[] };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được DB: ${m}` };
  }
}

export async function createShopeeAccount(fd: FormData): Promise<SimpleResult> {
  const label = text(fd, "label");
  const appId = text(fd, "app_id");
  const appSecret = text(fd, "app_secret");
  if (!label || !appId || !appSecret) {
    return { ok: false, error: "Cần nhập Tên, AppId và Secret." };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const isDefault = fd.get("is_default") === "true";
    if (isDefault) {
      await supabase.from("shopee_accounts").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { error } = await supabase.from("shopee_accounts").insert({
      label,
      app_id: appId,
      app_secret: appSecret,
      api_endpoint: text(fd, "api_endpoint") ?? "https://open-api.affiliate.shopee.vn/graphql",
      note: text(fd, "note"),
      is_default: isDefault,
      status: "ACTIVE",
    });
    if (error) return { ok: false, error: `Thêm tài khoản thất bại: ${error.message}` };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Thêm tài khoản thất bại: ${m}` };
  }
}

export async function updateShopeeAccount(id: string, fd: FormData): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã tài khoản." };
  const label = text(fd, "label");
  const appId = text(fd, "app_id");
  if (!label || !appId) return { ok: false, error: "Cần Tên và AppId." };
  try {
    const supabase = createSupabaseAdminClient();
    const patch: Record<string, unknown> = {
      label,
      app_id: appId,
      api_endpoint: text(fd, "api_endpoint") ?? "https://open-api.affiliate.shopee.vn/graphql",
      note: text(fd, "note"),
      status: text(fd, "status") === "DISABLED" ? "DISABLED" : "ACTIVE",
      updated_at: new Date().toISOString(),
    };
    // Chỉ đổi secret khi người dùng nhập mới (để trống = giữ nguyên).
    const newSecret = text(fd, "app_secret");
    if (newSecret) patch.app_secret = newSecret;

    const { error } = await supabase.from("shopee_accounts").update(patch).eq("id", id);
    if (error) return { ok: false, error: `Cập nhật thất bại: ${error.message}` };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}

export async function deleteShopeeAccount(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã tài khoản." };
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("shopee_accounts").delete().eq("id", id);
    if (error) return { ok: false, error: `Xóa thất bại: ${error.message}` };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Xóa thất bại: ${m}` };
  }
}

/** Đọc credential (server-only) — KHÔNG export ra client trực tiếp. */
async function getCredential(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  accountId: string,
): Promise<ShopeeApiCredential | null> {
  const { data } = await supabase
    .from("shopee_accounts")
    .select("app_id, app_secret, api_endpoint, status")
    .eq("id", accountId)
    .single();
  if (!data || data.status !== "ACTIVE") return null;
  return { app_id: data.app_id as string, app_secret: data.app_secret as string, api_endpoint: (data.api_endpoint as string | null) ?? null };
}

export type ScanResult =
  | { ok: true; created: number; skipped: number; total: number; sample: string[] }
  | { ok: false; error: string; raw?: unknown };

/**
 * AI tự quét + tự chuyển đổi: gọi API tài khoản, tạo products READY sẵn
 * (affiliate_link = offerLink của tài khoản, ảnh = imageUrl). Dedup theo offerLink.
 */
export async function scanAndImportShopeeProducts(
  accountId: string,
  keyword: string,
  limit = 20,
): Promise<ScanResult> {
  if (!accountId) return { ok: false, error: "Chưa chọn tài khoản." };
  if (!keyword?.trim()) return { ok: false, error: "Nhập từ khóa để quét." };

  try {
    const supabase = createSupabaseAdminClient();
    const cred = await getCredential(supabase, accountId);
    if (!cred) return { ok: false, error: "Tài khoản không tồn tại hoặc đang DISABLED." };

    const res = await searchProductOffers(cred, { keyword: keyword.trim(), limit });
    if (!res.ok) return { ok: false, error: res.error ?? "Quét thất bại.", raw: res.raw };

    const offers = res.offers.filter((o) => o.offerLink && o.productName);
    const total = offers.length;
    if (total === 0) return { ok: true, created: 0, skipped: 0, total: 0, sample: [] };

    // Dedup theo affiliate_link đã có.
    const links = offers.map((o) => o.offerLink as string);
    const { data: existing } = await supabase.from("products").select("affiliate_link").in("affiliate_link", links);
    const have = new Set((existing ?? []).map((r) => String(r.affiliate_link)));

    const rows: Record<string, unknown>[] = [];
    const sample: string[] = [];
    for (const o of offers) {
      if (have.has(o.offerLink as string)) continue;
      const name = o.productName ?? "Sản phẩm Shopee";
      rows.push({
        product_name: name,
        affiliate_link: o.offerLink,
        original_url: o.productLink ?? null,
        sub_id: generateSubId(name),
        link_status: deriveLinkStatus(o.offerLink),
        image_url: o.imageUrl ?? null,
        source_product_images: o.imageUrl ? [o.imageUrl] : [],
        source_capture_status: o.imageUrl ? "CAPTURED" : "PENDING",
        source_capture_method: "shopee_affiliate_api",
        source_captured_at: new Date().toISOString(),
        price_note: "giá có thể thay đổi theo thời điểm",
        status: "ACTIVE",
        shopee_account_id: accountId,
        // HOTFIX — lưu id/link gốc để kiểm chứng; chưa xác minh tồn tại -> UNKNOWN/UNVERIFIED.
        // Quét CHỈ lấy sản phẩm + link + ảnh gốc Shopee; KHÔNG gọi API tạo ảnh AI.
        shop_id: o.shopId ?? null,
        item_id: o.itemId ?? null,
        resolved_url: o.productLink ?? null,
        product_status: "UNKNOWN",
        validation_status: "UNVERIFIED",
      });
      if (sample.length < 5) sample.push(name);
    }

    let created = 0;
    if (rows.length > 0) {
      let { error } = await supabase.from("products").insert(rows);
      if (error) {
        // Fallback: nếu migration cột mới (shop_id/product_status...) CHƯA chạy -> bỏ cột mới rồi thử lại.
        const reduced = rows.map((r) => {
          const copy = { ...(r as Record<string, unknown>) };
          delete copy.shop_id;
          delete copy.item_id;
          delete copy.resolved_url;
          delete copy.product_status;
          delete copy.validation_status;
          return copy;
        });
        ({ error } = await supabase.from("products").insert(reduced));
      }
      if (error) return { ok: false, error: `Lưu sản phẩm thất bại: ${error.message}` };
      created = rows.length;
    }
    await supabase.from("shopee_accounts").update({ last_used_at: new Date().toISOString() }).eq("id", accountId);

    revalidatePath("/dashboard/products");
    revalidatePath(PATH);
    return { ok: true, created, skipped: total - created, total, sample };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Quét thất bại: ${m}` };
  }
}
