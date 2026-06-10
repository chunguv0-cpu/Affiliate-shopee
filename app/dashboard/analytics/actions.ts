"use server";

import { revalidatePath } from "next/cache";

import { insertPostingLog } from "@/lib/posts/log";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  normalizeReportDate,
  toIntSafe,
  toNumberSafe,
  type ReportRowInput,
} from "@/lib/analytics";

export type ImportReportResult =
  | { ok: true; inserted: number; warnings: string[] }
  | { ok: false; error: string };

export type Totals = {
  clicks: number;
  orders: number;
  commission: number;
  revenue: number;
  conversionRate: number; // %
  epc: number; // commission / clicks
};

export type SubIdRow = {
  sub_id: string;
  clicks: number;
  orders: number;
  commission: number;
  conversionRate: number;
  epc: number;
};

export type ProductRow = {
  product_id: string;
  product_name: string;
  sub_id: string | null;
  clicks: number;
  orders: number;
  commission: number;
  campaigns: string[];
};

export type PostRow = {
  post_id: string;
  product_name: string;
  content_angle_variant: string | null;
  campaign_name: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  sub_id: string | null;
  clicks: number;
  orders: number;
  commission: number;
};

export type AnalyticsFilters = {
  from?: string | null;
  to?: string | null;
  subId?: string | null;
};

export type AnalyticsData = {
  ok: boolean;
  error?: string;
  totals: Totals;
  bySubId: SubIdRow[];
  byProduct: ProductRow[];
  byPost: PostRow[];
  remarks: string[];
  availableSubIds: string[];
  reportCount: number;
};

const IMPORT_ACTION = "IMPORT_AFFILIATE_REPORT";
const MAX_ROWS = 2000;

function rate(orders: number, clicks: number): number {
  return clicks > 0 ? (orders / clicks) * 100 : 0;
}
function epc(commission: number, clicks: number): number {
  return clicks > 0 ? commission / clicks : 0;
}

/**
 * Import các dòng báo cáo affiliate (đã parse từ CSV ở client).
 */
export async function importAffiliateReportRows(
  rows: ReportRowInput[],
): Promise<ImportReportResult> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "Không có dòng báo cáo nào để import." };
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `Tối đa ${MAX_ROWS} dòng mỗi lần import.` };
  }

  const warnings: string[] = [];
  const noKey = rows.filter((r) => !r.sub_id && !r.affiliate_link).length;
  if (noKey > 0) {
    warnings.push(
      `${noKey}/${rows.length} dòng không có sub_id/affiliate_link — khó map về bài đăng.`,
    );
  }

  const records = rows.map((r) => ({
    report_date: normalizeReportDate(r.report_date),
    sub_id: r.sub_id,
    affiliate_link: r.affiliate_link,
    product_name: r.product_name,
    clicks: toIntSafe(r.clicks),
    orders: toIntSafe(r.orders),
    commission: toNumberSafe(r.commission),
    revenue: toNumberSafe(r.revenue),
    status: r.status,
    raw_row: r.raw_row ?? null,
  }));

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  const { error } = await supabase.from("affiliate_reports").insert(records);
  if (error) {
    return { ok: false, error: `Import báo cáo thất bại: ${error.message}` };
  }

  await insertPostingLog(
    supabase,
    null,
    IMPORT_ACTION,
    "SUCCESS",
    `Đã import ${records.length} dòng báo cáo affiliate.`,
    { inserted: records.length, warnings },
  );

  revalidatePath("/dashboard/analytics");
  return { ok: true, inserted: records.length, warnings };
}

const EMPTY_TOTALS: Totals = {
  clicks: 0,
  orders: 0,
  commission: 0,
  revenue: 0,
  conversionRate: 0,
  epc: 0,
};

function emptyData(error?: string): AnalyticsData {
  return {
    ok: !error,
    error,
    totals: EMPTY_TOTALS,
    bySubId: [],
    byProduct: [],
    byPost: [],
    remarks: [],
    availableSubIds: [],
    reportCount: 0,
  };
}

type ReportRow = {
  sub_id: string | null;
  affiliate_link: string | null;
  clicks: unknown;
  orders: unknown;
  commission: unknown;
  revenue: unknown;
};

/**
 * Tổng hợp dữ liệu analytics (lọc theo ngày + sub_id).
 */
export async function getAnalytics(
  filters: AnalyticsFilters = {},
): Promise<AnalyticsData> {
  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return emptyData(`Không kết nối được cơ sở dữ liệu: ${m}`);
  }

  // 1) Lấy báo cáo theo filter.
  let query = supabase.from("affiliate_reports").select("*");
  if (filters.from) query = query.gte("report_date", filters.from);
  if (filters.to) query = query.lte("report_date", filters.to);
  if (filters.subId) query = query.eq("sub_id", filters.subId);

  const reportsRes = await query;
  if (reportsRes.error) {
    return emptyData(`Không tải được báo cáo: ${reportsRes.error.message}`);
  }
  const reports = (reportsRes.data ?? []) as ReportRow[];

  const num = (v: unknown) => toNumberSafe(typeof v === "string" ? v : (v as number));

  // 2) Tổng quan.
  const totals: Totals = { ...EMPTY_TOTALS };
  for (const r of reports) {
    totals.clicks += num(r.clicks);
    totals.orders += num(r.orders);
    totals.commission += num(r.commission);
    totals.revenue += num(r.revenue);
  }
  totals.conversionRate = rate(totals.orders, totals.clicks);
  totals.epc = epc(totals.commission, totals.clicks);

  // 3) Theo sub_id.
  const subMap = new Map<string, { clicks: number; orders: number; commission: number }>();
  for (const r of reports) {
    const key = r.sub_id ?? "(không có sub_id)";
    const s = subMap.get(key) ?? { clicks: 0, orders: 0, commission: 0 };
    s.clicks += num(r.clicks);
    s.orders += num(r.orders);
    s.commission += num(r.commission);
    subMap.set(key, s);
  }
  const bySubId: SubIdRow[] = [...subMap.entries()]
    .map(([sub_id, s]) => ({
      sub_id,
      clicks: s.clicks,
      orders: s.orders,
      commission: s.commission,
      conversionRate: rate(s.orders, s.clicks),
      epc: epc(s.commission, s.clicks),
    }))
    .sort((a, b) => b.commission - a.commission);

  // 4) Lấy products + generated_posts + campaigns để map.
  const [productsRes, postsRes, campaignsRes] = await Promise.all([
    supabase.from("products").select("id, product_name, sub_id, affiliate_link"),
    supabase
      .from("generated_posts")
      .select("id, product_id, campaign_id, content_angle_variant, scheduled_at, published_at"),
    supabase.from("campaigns").select("id, name"),
  ]);

  const products = (productsRes.data ?? []) as {
    id: string;
    product_name: string;
    sub_id: string | null;
    affiliate_link: string | null;
  }[];
  const posts = (postsRes.data ?? []) as {
    id: string;
    product_id: string | null;
    campaign_id: string | null;
    content_angle_variant: string | null;
    scheduled_at: string | null;
    published_at: string | null;
  }[];
  const campaignName = new Map<string, string>();
  for (const c of (campaignsRes.data ?? []) as { id: string; name: string }[]) {
    campaignName.set(c.id, c.name);
  }

  const sumReportsFor = (subId: string | null, affiliateLink: string | null) => {
    const acc = { clicks: 0, orders: 0, commission: 0 };
    for (const r of reports) {
      const matchSub = subId && r.sub_id === subId;
      const matchLink = affiliateLink && r.affiliate_link === affiliateLink;
      if (matchSub || matchLink) {
        acc.clicks += num(r.clicks);
        acc.orders += num(r.orders);
        acc.commission += num(r.commission);
      }
    }
    return acc;
  };

  // 5) Theo sản phẩm (chỉ hiện sản phẩm map được ít nhất 1 báo cáo).
  const campaignsByProduct = new Map<string, Set<string>>();
  for (const p of posts) {
    if (!p.product_id || !p.campaign_id) continue;
    const name = campaignName.get(p.campaign_id);
    if (!name) continue;
    const set = campaignsByProduct.get(p.product_id) ?? new Set<string>();
    set.add(name);
    campaignsByProduct.set(p.product_id, set);
  }

  const byProduct: ProductRow[] = products
    .map((p) => {
      const agg = sumReportsFor(p.sub_id, p.affiliate_link);
      return {
        product_id: p.id,
        product_name: p.product_name,
        sub_id: p.sub_id,
        clicks: agg.clicks,
        orders: agg.orders,
        commission: agg.commission,
        campaigns: [...(campaignsByProduct.get(p.id) ?? [])],
      };
    })
    .filter((row) => row.clicks > 0 || row.orders > 0 || row.commission > 0)
    .sort((a, b) => b.commission - a.commission);

  // 6) Theo bài đăng (map gần đúng qua sub_id của sản phẩm).
  const productById = new Map(products.map((p) => [p.id, p]));
  const byPost: PostRow[] = [];
  for (const post of posts) {
    const product = post.product_id ? productById.get(post.product_id) : undefined;
    if (!product || !product.sub_id) continue;
    const agg = sumReportsFor(product.sub_id, product.affiliate_link);
    if (agg.clicks === 0 && agg.orders === 0 && agg.commission === 0) continue;
    byPost.push({
      post_id: post.id,
      product_name: product.product_name,
      content_angle_variant: post.content_angle_variant,
      campaign_name: post.campaign_id ? campaignName.get(post.campaign_id) ?? null : null,
      scheduled_at: post.scheduled_at,
      published_at: post.published_at,
      sub_id: product.sub_id,
      clicks: agg.clicks,
      orders: agg.orders,
      commission: agg.commission,
    });
  }

  // 7) Nhận xét nhanh (rule đơn giản).
  const remarks: string[] = [];
  if (reports.length > 0) {
    if (totals.conversionRate >= 3) {
      remarks.push("Conversion tốt — nên tiếp tục đẩy nhóm này.");
    }
    if (totals.clicks >= 100 && totals.conversionRate < 1) {
      remarks.push("Clicks cao nhưng đơn thấp — hook tốt nhưng sản phẩm/chuyển đổi yếu.");
    }
    if (totals.clicks < 50) {
      remarks.push("Clicks thấp — cần đổi hook hoặc khung giờ đăng.");
    }
    if (totals.commission >= 100000) {
      remarks.push("Hoa hồng cao — ưu tiên tạo thêm biến thể nội dung.");
    }
    if (remarks.length === 0) {
      remarks.push("Dữ liệu ở mức trung bình — tiếp tục theo dõi thêm.");
    }
  }

  const availableSubIds = [...subMap.keys()].filter((k) => k !== "(không có sub_id)");

  return {
    ok: true,
    totals,
    bySubId,
    byProduct,
    byPost,
    remarks,
    availableSubIds,
    reportCount: reports.length,
  };
}
