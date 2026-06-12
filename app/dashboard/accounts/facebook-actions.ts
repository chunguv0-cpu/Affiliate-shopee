"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { FacebookPage, FacebookPageStatus } from "@/lib/types";

const PATH = "/dashboard/accounts";

export type SimpleResult = { ok: true; message?: string } | { ok: false; error: string };
export type PagesResult = { ok: true; pages: FacebookPage[] } | { ok: false; error: string };

// KHÔNG bao giờ trả page_access_token ra client — chỉ token đã che.
const PAGE_COLS = "id, name, page_id, page_name, page_access_token, token_expires_at, status, is_default, notes, last_publish_test_at, last_publish_test_result, created_at, updated_at";

function maskToken(token: string | null | undefined): string | null {
  const t = (token ?? "").trim();
  if (!t) return null;
  return `••••${t.slice(-4)}`;
}

function text(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Danh sách Page — KHÔNG trả token thật, chỉ token_masked. */
export async function getFacebookPages(): Promise<PagesResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("facebook_pages")
      .select(PAGE_COLS)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: `Không tải được Page: ${error.message}` };
    const pages: FacebookPage[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      page_id: String(r.page_id ?? ""),
      page_name: (r.page_name as string | null) ?? null,
      token_masked: maskToken(r.page_access_token as string | null),
      token_expires_at: (r.token_expires_at as string | null) ?? null,
      status: (r.status as FacebookPageStatus) ?? "ACTIVE",
      is_default: Boolean(r.is_default),
      notes: (r.notes as string | null) ?? null,
      last_publish_test_at: (r.last_publish_test_at as string | null) ?? null,
      last_publish_test_result: r.last_publish_test_result ?? null,
      created_at: String(r.created_at ?? ""),
      updated_at: String(r.updated_at ?? ""),
    }));
    return { ok: true, pages };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được DB: ${m}` };
  }
}

export async function createFacebookPage(fd: FormData): Promise<SimpleResult> {
  const name = text(fd, "name");
  const pageId = text(fd, "page_id");
  const token = text(fd, "page_access_token");
  if (!name || !pageId || !token) return { ok: false, error: "Cần nhập Tên, Page ID và Access Token." };
  try {
    const supabase = createSupabaseAdminClient();
    const isDefault = fd.get("is_default") === "true";
    if (isDefault) {
      await supabase.from("facebook_pages").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { error } = await supabase.from("facebook_pages").insert({
      name,
      page_id: pageId,
      page_name: text(fd, "page_name"),
      page_access_token: token,
      notes: text(fd, "notes"),
      is_default: isDefault,
      status: "ACTIVE",
    });
    if (error) return { ok: false, error: `Thêm Page thất bại: ${error.message}` };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Thêm Page thất bại: ${m}` };
  }
}

export async function updateFacebookPage(id: string, fd: FormData): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã Page." };
  const name = text(fd, "name");
  const pageId = text(fd, "page_id");
  if (!name || !pageId) return { ok: false, error: "Cần Tên và Page ID." };
  try {
    const supabase = createSupabaseAdminClient();
    const patch: Record<string, unknown> = {
      name,
      page_id: pageId,
      page_name: text(fd, "page_name"),
      notes: text(fd, "notes"),
      status: text(fd, "status") === "DISABLED" ? "DISABLED" : "ACTIVE",
      updated_at: new Date().toISOString(),
    };
    const newToken = text(fd, "page_access_token");
    if (newToken) patch.page_access_token = newToken; // để trống = giữ token cũ
    const { error } = await supabase.from("facebook_pages").update(patch).eq("id", id);
    if (error) return { ok: false, error: `Cập nhật thất bại: ${error.message}` };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Cập nhật thất bại: ${m}` };
  }
}

export async function setDefaultFacebookPage(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã Page." };
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("facebook_pages").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("facebook_pages").update({ is_default: true, status: "ACTIVE", updated_at: new Date().toISOString() }).eq("id", id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Đặt mặc định thất bại: ${m}` };
  }
}

export async function deleteFacebookPage(id: string): Promise<SimpleResult> {
  if (!id) return { ok: false, error: "Thiếu mã Page." };
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("facebook_pages").delete().eq("id", id);
    if (error) return { ok: false, error: `Xóa thất bại: ${error.message}` };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Xóa thất bại: ${m}` };
  }
}

/** Kiểm tra kết nối Page: gọi Graph API lấy tên Page. KHÔNG log token. */
export async function testFacebookPage(id: string): Promise<{ ok: boolean; pageName?: string; error?: string }> {
  if (!id) return { ok: false, error: "Thiếu mã Page." };
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase.from("facebook_pages").select("page_id, page_access_token").eq("id", id).maybeSingle();
    const pageId = (data?.page_id as string | null)?.trim();
    const token = (data?.page_access_token as string | null)?.trim();
    if (!pageId || !token) return { ok: false, error: "Page thiếu page_id hoặc token." };
    const url = `https://graph.facebook.com/v24.0/${encodeURIComponent(pageId)}?fields=name&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    const nowIso = new Date().toISOString();
    if (!res.ok || json.error) {
      const errMsg = json.error?.message ?? `HTTP ${res.status}`;
      await supabase.from("facebook_pages").update({
        status: "ERROR",
        last_publish_test_at: nowIso,
        last_publish_test_result: { ok: false, error: errMsg },
        updated_at: nowIso,
      }).eq("id", id);
      revalidatePath(PATH);
      return { ok: false, error: errMsg };
    }
    const pageName = json.name ?? null;
    await supabase.from("facebook_pages").update({
      status: "ACTIVE",
      page_name: pageName,
      last_publish_test_at: nowIso,
      last_publish_test_result: { ok: true, page_name: pageName },
      updated_at: nowIso,
    }).eq("id", id);
    revalidatePath(PATH);
    return { ok: true, pageName: pageName ?? undefined };
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Kiểm tra Page thất bại: ${m}` };
  }
}
