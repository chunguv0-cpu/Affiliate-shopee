"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  PRODUCT_STATUSES,
  type Product,
  type ProductStatus,
} from "@/lib/types";

/** Kết quả cho action không trả dữ liệu. */
export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

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

const PRODUCTS_PATH = "/dashboard/products";

/** Chuẩn hóa giá trị text từ FormData: trim, rỗng -> null. */
function readText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Ép status về một ProductStatus hợp lệ, mặc định "NEW". */
function normalizeStatus(value: FormDataEntryValue | null): ProductStatus {
  if (typeof value === "string" && PRODUCT_STATUSES.includes(value as ProductStatus)) {
    return value as ProductStatus;
  }
  return "NEW";
}

/**
 * Validate các field bắt buộc của sản phẩm.
 * Trả về thông báo lỗi (tiếng Việt) nếu không hợp lệ, ngược lại null.
 */
function validateRequired(
  productName: string | null,
  affiliateLink: string | null,
): string | null {
  if (!productName) {
    return "Tên sản phẩm là bắt buộc.";
  }
  if (!affiliateLink) {
    return "Link affiliate là bắt buộc.";
  }
  if (!/^https?:\/\//i.test(affiliateLink)) {
    return "Link affiliate phải bắt đầu bằng http:// hoặc https://";
  }
  return null;
}

/**
 * Lấy danh sách sản phẩm, sắp xếp theo created_at giảm dần.
 */
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

/**
 * Thống kê số lượng sản phẩm theo trạng thái cho trang Tổng quan.
 * Không ném lỗi — nếu thất bại trả về 0 để dashboard không crash.
 */
export async function getProductStats(): Promise<ProductStats> {
  const empty: ProductStats = { total: 0, active: 0, paused: 0, archived: 0 };
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from("products").select("status");

    if (error || !data) {
      return empty;
    }

    return data.reduce<ProductStats>((acc, row) => {
      acc.total += 1;
      if (row.status === "ACTIVE") acc.active += 1;
      else if (row.status === "PAUSED") acc.paused += 1;
      else if (row.status === "ARCHIVED") acc.archived += 1;
      return acc;
    }, { ...empty });
  } catch {
    return empty;
  }
}

/**
 * Thêm sản phẩm mới.
 */
export async function createProduct(formData: FormData): Promise<ActionResult> {
  try {
    const productName = readText(formData, "product_name");
    const affiliateLink = readText(formData, "affiliate_link");

    const validationError = validateRequired(productName, affiliateLink);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("products").insert({
      product_name: productName,
      affiliate_link: affiliateLink,
      price_note: readText(formData, "price_note"),
      target_customer: readText(formData, "target_customer"),
      product_angle: readText(formData, "product_angle"),
      image_url: readText(formData, "image_url"),
      status: normalizeStatus(formData.get("status")),
    });

    if (error) {
      return { ok: false, error: `Thêm sản phẩm thất bại: ${error.message}` };
    }

    revalidatePath(PRODUCTS_PATH);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Thêm sản phẩm thất bại: ${message}` };
  }
}

/**
 * Cập nhật sản phẩm theo id.
 */
export async function updateProduct(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    if (!id || typeof id !== "string") {
      return { ok: false, error: "Thiếu mã sản phẩm cần cập nhật." };
    }

    const productName = readText(formData, "product_name");
    const affiliateLink = readText(formData, "affiliate_link");

    const validationError = validateRequired(productName, affiliateLink);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("products")
      .update({
        product_name: productName,
        affiliate_link: affiliateLink,
        price_note: readText(formData, "price_note"),
        target_customer: readText(formData, "target_customer"),
        product_angle: readText(formData, "product_angle"),
        image_url: readText(formData, "image_url"),
        status: normalizeStatus(formData.get("status")),
        // Phòng trường hợp trigger updated_at chưa được tạo trong DB.
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return { ok: false, error: `Cập nhật sản phẩm thất bại: ${error.message}` };
    }

    revalidatePath(PRODUCTS_PATH);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật sản phẩm thất bại: ${message}` };
  }
}

/**
 * Xóa sản phẩm theo id.
 */
export async function deleteProduct(id: string): Promise<ActionResult> {
  try {
    if (!id || typeof id !== "string") {
      return { ok: false, error: "Thiếu mã sản phẩm cần xóa." };
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("products").delete().eq("id", id);

    if (error) {
      return { ok: false, error: `Xóa sản phẩm thất bại: ${error.message}` };
    }

    revalidatePath(PRODUCTS_PATH);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Xóa sản phẩm thất bại: ${message}` };
  }
}
