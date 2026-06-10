"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { generateAffiliateCaption, type ProductInput } from "@/lib/ai/client";
import { buildCreativeFields } from "@/lib/posts/creative";
import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  CAMPAIGN_DEFAULT_TIME_SLOTS,
  CONTENT_ANGLE_VARIANTS,
  type Campaign,
  type GeneratedPostStatus,
  type Product,
} from "@/lib/types";

/** Giới hạn tối đa số bài tạo trong 1 lần chạy chiến dịch (chống spam). */
const MAX_POSTS_PER_CAMPAIGN = 20;

const CAMPAIGN_ACTION = "CAMPAIGN_GENERATE_POST";

export type CreateCampaignResult =
  | {
      ok: true;
      campaignId: string;
      createdPosts: number;
      rejectedPosts: number;
      failedPosts: number;
    }
  | { ok: false; error: string };

export type CampaignStats = {
  total: number;
  ready: number;
  published: number;
  failed: number;
};

export type CampaignListItem = { campaign: Campaign; stats: CampaignStats };

export type CampaignsResult =
  | { ok: true; items: CampaignListItem[] }
  | { ok: false; error: string };

export type ActiveProductsResult =
  | { ok: true; products: Product[] }
  | { ok: false; error: string };

function readText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function readInt(formData: FormData, key: string, fallback: number): number {
  const raw = formData.get(key);
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Dựng danh sách thời điểm đăng (ISO) theo: ngày bắt đầu + số ngày + khung giờ.
 * Dùng múi giờ Việt Nam (+07:00) cho các khung giờ.
 */
function buildSlots(
  startDate: string,
  days: number,
  perDayTimes: string[],
  max: number,
): string[] {
  const base = new Date(`${startDate}T00:00:00+07:00`);
  if (Number.isNaN(base.getTime())) return [];

  const slots: string[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;

  for (let day = 0; day < days; day += 1) {
    for (const time of perDayTimes) {
      const [hh, mm] = time.split(":").map((x) => parseInt(x, 10));
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
      const slot = new Date(
        base.getTime() + day * DAY_MS + hh * 60 * 60 * 1000 + mm * 60 * 1000,
      );
      slots.push(slot.toISOString());
      if (slots.length >= max) return slots;
    }
  }
  return slots;
}

/**
 * Tạo chiến dịch và sinh + phân bổ lịch hàng loạt cho các sản phẩm đã chọn.
 * KHÔNG đăng ngay — chỉ tạo bài với scheduled_at để cron tự đăng khi đến giờ.
 */
export async function createCampaignAndSchedulePosts(
  formData: FormData,
): Promise<CreateCampaignResult> {
  // 1) Validate input.
  const name = readText(formData, "name");
  if (!name) return { ok: false, error: "Tên chiến dịch là bắt buộc." };

  const productIds = formData
    .getAll("product_ids")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (productIds.length === 0) {
    return { ok: false, error: "Hãy chọn ít nhất 1 sản phẩm." };
  }

  const days = readInt(formData, "days", 0);
  if (days < 1) return { ok: false, error: "Số ngày chạy phải >= 1." };

  const postsPerDay = readInt(formData, "posts_per_day", 0);
  if (postsPerDay < 1) return { ok: false, error: "Số bài mỗi ngày phải >= 1." };

  // Phase 10.1: cho phép lặp sản phẩm để lấp đầy lịch bằng nhiều góc viết.
  const allowRepeatProducts = formData.get("allowRepeatProducts") === "true";
  const maxVariantsPerProduct = Math.min(
    5,
    Math.max(1, readInt(formData, "maxVariantsPerProduct", 3)),
  );

  const startDate = readText(formData, "start_date");
  if (!startDate) return { ok: false, error: "Ngày bắt đầu là bắt buộc." };

  const description = readText(formData, "description");

  let selectedTimes = formData
    .getAll("time_slots")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (selectedTimes.length === 0) selectedTimes = [...CAMPAIGN_DEFAULT_TIME_SLOTS];
  selectedTimes.sort(); // theo thứ tự thời gian trong ngày

  // Số khung giờ dùng mỗi ngày = min(số bài/ngày, số khung giờ đã chọn).
  const perDayTimes = selectedTimes.slice(0, postsPerDay);
  if (perDayTimes.length === 0) {
    return { ok: false, error: "Hãy chọn ít nhất 1 khung giờ đăng." };
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  try {
    // 2) Lấy sản phẩm đã chọn.
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (productsError) {
      return { ok: false, error: `Không tải được sản phẩm: ${productsError.message}` };
    }
    const allSelected = (productsData ?? []) as Product[];
    if (allSelected.length === 0) {
      return { ok: false, error: "Không tìm thấy sản phẩm đã chọn." };
    }

    // Phase 11: chỉ dùng sản phẩm có link affiliate hợp lệ (link_status = READY).
    const products = allSelected.filter(
      (p) => p.link_status === "READY" && !!p.affiliate_link,
    );
    if (products.length === 0) {
      return {
        ok: false,
        error:
          "Sản phẩm chưa có link Affiliate hợp lệ. Vui lòng chuyển link trước khi tạo bài.",
      };
    }

    // 3) Dựng slot, rồi phân công (sản phẩm + góc viết) cho từng slot.
    const slots = buildSlots(startDate, days, perDayTimes, MAX_POSTS_PER_CAMPAIGN);
    if (slots.length === 0) {
      return { ok: false, error: "Không tạo được slot lịch nào. Kiểm tra lại ngày/khung giờ." };
    }
    const target = Math.min(slots.length, MAX_POSTS_PER_CAMPAIGN);

    type Assignment = { product: Product; angle: string | null };
    const assignments: Assignment[] = [];

    if (allowRepeatProducts) {
      // Lặp sản phẩm để lấp đầy slot; mỗi vòng gán một góc viết khác nhau,
      // mỗi sản phẩm tối đa maxVariantsPerProduct biến thể.
      for (
        let v = 0;
        v < maxVariantsPerProduct && assignments.length < target;
        v += 1
      ) {
        for (const product of products) {
          if (assignments.length >= target) break;
          assignments.push({
            product,
            angle: CONTENT_ANGLE_VARIANTS[v % CONTENT_ANGLE_VARIANTS.length],
          });
        }
      }
    } else {
      // Logic cũ: mỗi sản phẩm 1 bài.
      const n = Math.min(products.length, target);
      for (let i = 0; i < n; i += 1) {
        assignments.push({ product: products[i], angle: null });
      }
    }

    const count = assignments.length;
    if (count === 0) {
      return { ok: false, error: "Không có bài nào để tạo." };
    }

    // 4) Tạo campaign.
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .insert({
        name,
        description,
        status: "ACTIVE",
        start_at: slots[0],
        end_at: slots[count - 1],
      })
      .select("id")
      .single();

    if (campaignError || !campaign) {
      const m = campaignError?.message ?? "không rõ nguyên nhân";
      return { ok: false, error: `Tạo chiến dịch thất bại: ${m}` };
    }
    const campaignId = campaign.id as string;

    // 5) Sinh caption + insert từng bài theo slot.
    let createdPosts = 0;
    let rejectedPosts = 0;
    let failedPosts = 0;

    for (let i = 0; i < count; i += 1) {
      const { product, angle } = assignments[i];
      const scheduledAt = slots[i];

      const input: ProductInput = {
        id: product.id,
        product_name: product.product_name,
        affiliate_link: product.affiliate_link ?? "",
        price_note: product.price_note,
        target_customer: product.target_customer,
        product_angle: product.product_angle,
        image_url: product.image_url,
        content_angle_variant: angle,
      };

      try {
        const result = await generateAffiliateCaption(input);
        const status: GeneratedPostStatus =
          result.score >= 80 && result.should_publish === true
            ? "READY"
            : "REJECTED";

        const creative = buildCreativeFields(product.image_url, result);
        const { data: inserted, error: insertError } = await supabase
          .from("generated_posts")
          .insert({
            product_id: product.id,
            campaign_id: campaignId,
            caption: result.caption,
            hook: result.hook,
            ai_score: result.score,
            safety_notes: result.safety_notes,
            should_publish: result.should_publish,
            status,
            scheduled_at: scheduledAt,
            content_angle_variant: angle,
            ...creative,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          failedPosts += 1;
          await insertPostingLog(
            supabase,
            null,
            CAMPAIGN_ACTION,
            "FAILED",
            `Lưu bài chiến dịch thất bại: ${insertError?.message ?? "không rõ"}`,
            { product_id: product.id, campaign_id: campaignId },
          );
          continue;
        }

        if (status === "READY") createdPosts += 1;
        else rejectedPosts += 1;

        await insertPostingLog(
          supabase,
          inserted.id as string,
          CAMPAIGN_ACTION,
          "SUCCESS",
          `Đã tạo bài campaign với angle: ${angle ?? "(mặc định)"} (trạng thái: ${status}, điểm: ${result.score}).`,
          { campaign_id: campaignId, content_angle_variant: angle },
        );

        // Phase 17 — log creative.
        await insertPostingLog(
          supabase,
          inserted.id as string,
          creative.creative_type === "IMAGE" ? "CREATIVE_ASSIGNED" : "CREATIVE_MISSING_ASSET",
          "SUCCESS",
          creative.creative_type === "IMAGE"
            ? `Gán ảnh sản phẩm cho bài (PHOTO).`
            : `Sản phẩm thiếu ảnh — bài đăng dạng TEXT_ONLY/FEED.`,
          { campaign_id: campaignId },
        );
      } catch (err) {
        // Lỗi AI cho 1 sản phẩm: ghi bài FAILED + log, KHÔNG dừng cả chiến dịch.
        failedPosts += 1;
        const message = err instanceof Error ? err.message : "Lỗi không xác định.";

        const { data: failedRow } = await supabase
          .from("generated_posts")
          .insert({
            product_id: product.id,
            campaign_id: campaignId,
            should_publish: false,
            status: "FAILED",
            error_log: message,
            scheduled_at: scheduledAt,
            content_angle_variant: angle,
          })
          .select("id")
          .single();

        await insertPostingLog(
          supabase,
          (failedRow?.id as string) ?? null,
          CAMPAIGN_ACTION,
          "FAILED",
          `Tạo caption chiến dịch thất bại (angle: ${angle ?? "(mặc định)"}): ${message}`,
          { product_id: product.id, campaign_id: campaignId },
        );
      }
    }

    revalidatePath("/dashboard/campaigns");
    revalidatePath("/dashboard/posts");
    revalidatePath("/dashboard/calendar");

    return { ok: true, campaignId, createdPosts, rejectedPosts, failedPosts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Tạo chiến dịch thất bại: ${message}` };
  }
}

/** Lấy sản phẩm trạng thái ACTIVE để chọn trong chiến dịch. */
export async function getActiveProducts(): Promise<ActiveProductsResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: `Không tải được sản phẩm: ${error.message}` };
    }
    return { ok: true, products: (data ?? []) as Product[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }
}

/** Lấy danh sách chiến dịch kèm thống kê bài. */
export async function getCampaigns(): Promise<CampaignsResult> {
  try {
    const supabase = createSupabaseAdminClient();

    const [campaignsRes, postsRes] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("generated_posts").select("campaign_id, status"),
    ]);

    if (campaignsRes.error) {
      return { ok: false, error: `Không tải được chiến dịch: ${campaignsRes.error.message}` };
    }

    const statsByCampaign = new Map<string, CampaignStats>();
    for (const row of postsRes.data ?? []) {
      const cid = row.campaign_id as string | null;
      if (!cid) continue;
      const s =
        statsByCampaign.get(cid) ?? { total: 0, ready: 0, published: 0, failed: 0 };
      s.total += 1;
      if (row.status === "READY") s.ready += 1;
      else if (row.status === "PUBLISHED") s.published += 1;
      else if (row.status === "FAILED") s.failed += 1;
      statsByCampaign.set(cid, s);
    }

    const items: CampaignListItem[] = (campaignsRes.data ?? []).map((c) => ({
      campaign: c as Campaign,
      stats:
        statsByCampaign.get((c as Campaign).id) ?? {
          total: 0,
          ready: 0,
          published: 0,
          failed: 0,
        },
    }));

    return { ok: true, items };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${message}` };
  }
}
