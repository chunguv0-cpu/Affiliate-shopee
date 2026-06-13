"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { deriveLinkStatus, generateSubId } from "@/lib/affiliate";
import {
  buildProductValidationPatch,
  validateShopeeProductExists,
} from "@/lib/shopee/validate-product-link";
import {
  PRODUCT_STATUSES,
  type LinkStatus,
  type Product,
  type ProductLifeStatus,
  type ProductStatus,
} from "@/lib/types";

/** Kết quả cho action không trả dữ liệu. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Kết quả cho getProducts(). */
export type ProductsResult =
  | { ok: true; products: Product[] }
  | { ok: false; error: string };

/** Thống kê số lượng sản phẩm theo trạng thái. */
export type ProductStats = {
  total: number;
  active: number;
  paused: number;
  archived: number;
};

/** Kết quả lưu nhanh affiliate link. */
export type SaveLinkResult =
  | { ok: true; linkStatus: LinkStatus }
  | { ok: false; error: string };

/** Kết quả import CSV. */
export type ImportCsvResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

const PRODUCTS_PATH = "/dashboard/products";
// Phase 20: trang quản lý link đã gộp vào "Công cụ thủ công".
const LINKS_PATH = "/dashboard/manual-tools";

function readText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: FormDataEntryValue | null): ProductStatus {
  if (typeof value === "string" && PRODUCT_STATUSES.includes(value as ProductStatus)) {
    return value as ProductStatus;
  }
  return "NEW";
}

/**
 * Validate input sản phẩm (Phase 11).
 * - product_name bắt buộc.
 * - phải có ít nhất original_url HOẶC affiliate_link.
 * - affiliate_link nếu có phải bắt đầu http:// hoặc https://.
 */
function validateProductInput(
  productName: string | null,
  originalUrl: string | null,
  affiliateLink: string | null,
): string | null {
  if (!productName) return "Tên sản phẩm là bắt buộc.";
  if (!originalUrl && !affiliateLink) {
    return "Cần nhập ít nhất Link gốc (original_url) hoặc Link affiliate.";
  }
  if (affiliateLink && !/^https?:\/\//i.test(affiliateLink)) {
    return "Link affiliate phải bắt đầu bằng http:// hoặc https://";
  }
  return null;
}

export async function getProducts(): Promise<ProductsResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: `Không tải được danh sách sản phẩm: ${error.message}` };
    }
    return { ok: true, products: (data ?? []) as Product[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }
}

export async function getProductStats(): Promise<ProductStats> {
  const empty: ProductStats = { total: 0, active: 0, paused: 0, archived: 0 };
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from("products").select("status");
    if (error || !data) return empty;

    return data.reduce<ProductStats>(
      (acc, row) => {
        acc.total += 1;
        if (row.status === "ACTIVE") acc.active += 1;
        else if (row.status === "PAUSED") acc.paused += 1;
        else if (row.status === "ARCHIVED") acc.archived += 1;
        return acc;
      },
      { ...empty },
    );
  } catch {
    return empty;
  }
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  try {
    const productName = readText(formData, "product_name");
    const originalUrl = readText(formData, "original_url");
    const affiliateLink = readText(formData, "affiliate_link");

    const validationError = validateProductInput(productName, originalUrl, affiliateLink);
    if (validationError) return { ok: false, error: validationError };

    const subId = readText(formData, "sub_id") ?? generateSubId(productName ?? "sp");
    const linkStatus = deriveLinkStatus(affiliateLink);

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("products").insert({
      product_name: productName,
      original_url: originalUrl,
      affiliate_link: affiliateLink,
      sub_id: subId,
      link_status: linkStatus,
      link_note: readText(formData, "link_note"),
      price_note: readText(formData, "price_note"),
      target_customer: readText(formData, "target_customer"),
      product_angle: readText(formData, "product_angle"),
      image_url: readText(formData, "image_url"),
      status: normalizeStatus(formData.get("status")),
    });

    if (error) return { ok: false, error: `Thêm sản phẩm thất bại: ${error.message}` };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Thêm sản phẩm thất bại: ${message}` };
  }
}

export async function updateProduct(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    if (!id || typeof id !== "string") {
      return { ok: false, error: "Thiếu mã sản phẩm cần cập nhật." };
    }

    const productName = readText(formData, "product_name");
    const originalUrl = readText(formData, "original_url");
    const affiliateLink = readText(formData, "affiliate_link");

    const validationError = validateProductInput(productName, originalUrl, affiliateLink);
    if (validationError) return { ok: false, error: validationError };

    const subId = readText(formData, "sub_id") ?? generateSubId(productName ?? "sp");
    const linkStatus = deriveLinkStatus(affiliateLink);

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("products")
      .update({
        product_name: productName,
        original_url: originalUrl,
        affiliate_link: affiliateLink,
        sub_id: subId,
        link_status: linkStatus,
        link_note: readText(formData, "link_note"),
        price_note: readText(formData, "price_note"),
        target_customer: readText(formData, "target_customer"),
        product_angle: readText(formData, "product_angle"),
        image_url: readText(formData, "image_url"),
        status: normalizeStatus(formData.get("status")),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { ok: false, error: `Cập nhật sản phẩm thất bại: ${error.message}` };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật sản phẩm thất bại: ${message}` };
  }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  try {
    if (!id || typeof id !== "string") {
      return { ok: false, error: "Thiếu mã sản phẩm cần xóa." };
    }
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return { ok: false, error: `Xóa sản phẩm thất bại: ${error.message}` };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Xóa sản phẩm thất bại: ${message}` };
  }
}

/**
 * Lưu nhanh affiliate_link cho 1 sản phẩm (trang Affiliate Links).
 * Tự suy ra link_status từ link.
 */
export async function saveAffiliateLink(
  id: string,
  affiliateLink: string,
): Promise<SaveLinkResult> {
  try {
    if (!id || typeof id !== "string") {
      return { ok: false, error: "Thiếu mã sản phẩm." };
    }
    const link = (affiliateLink ?? "").trim();
    if (link && !/^https?:\/\//i.test(link)) {
      return { ok: false, error: "Link affiliate phải bắt đầu bằng http:// hoặc https://" };
    }

    const linkStatus = deriveLinkStatus(link || null);
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("products")
      .update({
        affiliate_link: link || null,
        link_status: linkStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { ok: false, error: `Lưu link thất bại: ${error.message}` };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true, linkStatus };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Lưu link thất bại: ${message}` };
  }
}

// ===========================================================================
// HOTFIX — Kiểm chứng link sản phẩm (sản phẩm chết -> không Sẵn sàng).
// ===========================================================================

export type RevalidateOneResult =
  | { ok: true; product_status: ProductLifeStatus; exists: boolean; message: string }
  | { ok: false; error: string };

const REVALIDATE_BATCH_SIZE = (() => {
  const raw = process.env.REVALIDATE_LINKS_BATCH_SIZE?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 20;
})();

/** Kiểm tra lại 1 link sản phẩm và cập nhật product_status/validation_*. KHÔNG xóa dữ liệu. */
export async function revalidateProductLink(productId: string): Promise<RevalidateOneResult> {
  if (!productId || typeof productId !== "string") return { ok: false, error: "Thiếu mã sản phẩm." };
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();
    if (error || !data) return { ok: false, error: "Không tìm thấy sản phẩm." };
    const p = data as Pick<Product, "id" | "product_name" | "affiliate_link" | "original_url" | "resolved_url" | "shop_id" | "item_id">;

    const result = await validateShopeeProductExists({
      affiliate_link: p.affiliate_link,
      original_url: p.original_url,
      resolved_url: p.resolved_url ?? null,
      shop_id: p.shop_id ?? null,
      item_id: p.item_id ?? null,
      product_name: p.product_name,
    });
    const { error: upErr } = await supabase.from("products").update(buildProductValidationPatch(result)).eq("id", p.id);
    if (upErr) return { ok: false, error: `Lưu kết quả kiểm chứng thất bại: ${upErr.message}` };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    const message =
      result.product_status === "ACTIVE"
        ? "Sản phẩm còn tồn tại."
        : result.product_status === "UNKNOWN"
          ? `Chưa xác định (${result.error ?? "có thể bị chặn bot"}).`
          : `Sản phẩm không tồn tại (${result.product_status}).`;
    return { ok: true, product_status: result.product_status, exists: result.exists, message };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Kiểm chứng thất bại: ${m}` };
  }
}

export type RevalidateAllResult =
  | { ok: true; checked: number; active: number; dead: number; unknown: number }
  | { ok: false; error: string };

/**
 * Kiểm tra lại nhiều link cũ theo batch nhỏ (REVALIDATE_LINKS_BATCH_SIZE).
 * Ưu tiên sản phẩm chưa kiểm chứng / kiểm chứng lâu nhất. KHÔNG xóa dữ liệu.
 */
export async function revalidateAllProductLinks(): Promise<RevalidateAllResult> {
  try {
    if (process.env.PRODUCT_LINK_VALIDATION_ENABLED?.trim().toLowerCase() === "false") {
      return { ok: false, error: "Kiểm chứng link đang tắt (PRODUCT_LINK_VALIDATION_ENABLED=false)." };
    }
    const supabase = createSupabaseAdminClient();
    // Lấy batch: ưu tiên last_validated_at NULL trước (chưa kiểm chứng), rồi cũ nhất.
    // select("*") + fallback order created_at để KHÔNG vỡ nếu migration cột mới chưa chạy.
    let q = await supabase
      .from("products")
      .select("*")
      .not("affiliate_link", "is", null)
      .order("last_validated_at", { ascending: true, nullsFirst: true })
      .limit(REVALIDATE_BATCH_SIZE);
    if (q.error) {
      q = await supabase
        .from("products")
        .select("*")
        .not("affiliate_link", "is", null)
        .order("created_at", { ascending: true })
        .limit(REVALIDATE_BATCH_SIZE);
    }
    if (q.error) return { ok: false, error: `Không tải được danh sách: ${q.error.message}` };
    const rows = (q.data ?? []) as Array<Pick<Product, "id" | "product_name" | "affiliate_link" | "original_url" | "resolved_url" | "shop_id" | "item_id">>;

    let active = 0;
    let dead = 0;
    let unknown = 0;
    for (const p of rows) {
      const result = await validateShopeeProductExists({
        affiliate_link: p.affiliate_link,
        original_url: p.original_url,
        resolved_url: p.resolved_url ?? null,
        shop_id: p.shop_id ?? null,
        item_id: p.item_id ?? null,
        product_name: p.product_name,
      });
      await supabase.from("products").update(buildProductValidationPatch(result)).eq("id", p.id);
      if (result.product_status === "ACTIVE") active += 1;
      else if (result.product_status === "UNKNOWN") unknown += 1;
      else dead += 1;
    }

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true, checked: rows.length, active, dead, unknown };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Kiểm chứng hàng loạt thất bại: ${m}` };
  }
}

/** Tách CSV (hỗ trợ field bọc dấu nháy kép). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Import hàng loạt sản phẩm + affiliate link từ CSV.
 * Header: product_name,original_url,affiliate_link,sub_id,price_note,target_customer,product_angle,status
 */
export async function importProductsCsv(csvText: string): Promise<ImportCsvResult> {
  try {
    if (!csvText || !csvText.trim()) {
      return { ok: false, error: "Chưa có nội dung CSV." };
    }

    const rows = parseCsv(csvText.trim()).filter((r) => r.some((c) => c.trim() !== ""));
    if (rows.length < 2) {
      return { ok: false, error: "CSV cần có dòng tiêu đề và ít nhất 1 dòng dữ liệu." };
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const iName = col("product_name");
    if (iName === -1) {
      return { ok: false, error: "CSV thiếu cột bắt buộc: product_name." };
    }
    const iOriginal = col("original_url");
    const iAff = col("affiliate_link");
    const iSub = col("sub_id");
    const iPrice = col("price_note");
    const iTarget = col("target_customer");
    const iAngle = col("product_angle");
    const iStatus = col("status");

    const pick = (r: string[], idx: number): string | null => {
      if (idx === -1) return null;
      const v = (r[idx] ?? "").trim();
      return v.length > 0 ? v : null;
    };

    const records: Record<string, unknown>[] = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];
      const name = pick(r, iName);
      if (!name) {
        skipped += 1;
        continue;
      }
      const affiliateLink = pick(r, iAff);
      const status = iStatus !== -1 && PRODUCT_STATUSES.includes(pick(r, iStatus) as ProductStatus)
        ? (pick(r, iStatus) as ProductStatus)
        : "NEW";

      records.push({
        product_name: name,
        original_url: pick(r, iOriginal),
        affiliate_link: affiliateLink,
        sub_id: pick(r, iSub) ?? generateSubId(name),
        link_status: deriveLinkStatus(affiliateLink),
        price_note: pick(r, iPrice),
        target_customer: pick(r, iTarget),
        product_angle: pick(r, iAngle),
        status,
      });
    }

    if (records.length === 0) {
      return { ok: false, error: "Không có dòng hợp lệ để import (thiếu product_name)." };
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("products").insert(records);
    if (error) return { ok: false, error: `Import thất bại: ${error.message}` };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(LINKS_PATH);
    return { ok: true, inserted: records.length, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Import thất bại: ${message}` };
  }
}
