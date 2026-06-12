"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

// ===========================================================================
// Phase 16 — Daily Operations Cockpit. CHỈ ĐỌC dữ liệu, không AI/FB/cron.
// Mọi truy vấn đều phòng thủ: bảng thiếu / quan hệ null không làm crash.
// ===========================================================================

export type OpsPost = {
  id: string;
  scheduled_at: string | null;
  status: string;
  caption: string | null;
  content_angle_variant: string | null;
  product_name: string;
  campaign_name: string | null;
};
export type OpsTask = {
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  reason: string;
  action: string;
  href: string;
};
export type OpsSourcing = {
  id: string;
  suggested_product: string;
  priority: string | null;
  confidence: string | null;
  status: string;
  keyword: string | null;
};
export type OpsCampaign = {
  id: string;
  name: string;
  start_at: string | null;
  end_at: string | null;
  total: number;
  ready: number;
  published: number;
  failed: number;
};
export type OpsRec = {
  id: string;
  title: string;
  planner_mode: string | null;
  goal: string | null;
  status: string;
  created_at: string;
  stuck: boolean;
};
export type OpsLog = {
  id: string;
  created_at: string;
  action: string | null;
  message: string | null;
};

export type OpsData = {
  todayStart: string;
  todayEnd: string;
  counts: {
    today: number;
    upcoming: number;
    published: number;
    failed24h: number;
    needLink: number;
    draftPlans: number;
  };
  todayPosts: OpsPost[];
  tasks: OpsTask[];
  sourcing: OpsSourcing[];
  campaigns: OpsCampaign[];
  recommendations: OpsRec[];
  errors: OpsLog[];
};

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function firstKeyword(v: unknown): string | null {
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return null;
}

export async function getOpsData(): Promise<OpsData> {
  const now = new Date();
  const nowIso = now.toISOString();
  // 00:00 hôm nay theo giờ VN (+07:00) quy về UTC.
  const ictNow = new Date(now.getTime() + 7 * 3600 * 1000);
  const startUtcMs =
    Date.UTC(ictNow.getUTCFullYear(), ictNow.getUTCMonth(), ictNow.getUTCDate(), 0, 0, 0) - 7 * 3600 * 1000;
  const todayStart = new Date(startUtcMs).toISOString();
  const todayEnd = new Date(startUtcMs + 24 * 3600 * 1000).toISOString();
  const last24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const empty: OpsData = {
    todayStart,
    todayEnd,
    counts: { today: 0, upcoming: 0, published: 0, failed24h: 0, needLink: 0, draftPlans: 0 },
    todayPosts: [],
    tasks: [],
    sourcing: [],
    campaigns: [],
    recommendations: [],
    errors: [],
  };

  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return empty;
  }

  // --- Bảng tra cứu: sản phẩm + campaign + thống kê bài theo campaign ---
  const products = await safe(async () => {
    const { data } = await supabase
      .from("products")
      .select("id, product_name, sub_id, status, link_status")
      .limit(1000);
    return (data ?? []) as Array<{
      id: string;
      product_name: string;
      sub_id: string | null;
      status: string;
      link_status: string;
    }>;
  }, []);
  const productNameById = new Map(products.map((p) => [p.id, p.product_name] as const));

  const campaignsAll = await safe(async () => {
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, status, start_at, end_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    return (data ?? []) as Array<{
      id: string;
      name: string;
      status: string;
      start_at: string | null;
      end_at: string | null;
    }>;
  }, []);
  const campaignNameById = new Map(campaignsAll.map((c) => [c.id, c.name] as const));

  const gpStats = await safe(async () => {
    const { data } = await supabase
      .from("generated_posts")
      .select("campaign_id, status, product_id")
      .limit(3000);
    return (data ?? []) as Array<{ campaign_id: string | null; status: string; product_id: string | null }>;
  }, []);

  const statsByCampaign = new Map<string, { total: number; ready: number; published: number; failed: number }>();
  const usedProductIds = new Set<string>();
  for (const g of gpStats) {
    if (g.product_id) usedProductIds.add(g.product_id);
    if (!g.campaign_id) continue;
    const s = statsByCampaign.get(g.campaign_id) ?? { total: 0, ready: 0, published: 0, failed: 0 };
    s.total += 1;
    if (g.status === "READY") s.ready += 1;
    else if (g.status === "PUBLISHED") s.published += 1;
    else if (g.status === "FAILED") s.failed += 1;
    statsByCampaign.set(g.campaign_id, s);
  }

  // --- Bài hôm nay ---
  const todayPosts = await safe(async () => {
    const { data } = await supabase
      .from("generated_posts")
      .select("id, scheduled_at, status, caption, content_angle_variant, product_id, campaign_id")
      .gte("scheduled_at", todayStart)
      .lt("scheduled_at", todayEnd)
      .order("scheduled_at", { ascending: true })
      .limit(50);
    return ((data ?? []) as Array<{
      id: string;
      scheduled_at: string | null;
      status: string;
      caption: string | null;
      content_angle_variant: string | null;
      product_id: string | null;
      campaign_id: string | null;
    }>).map<OpsPost>((p) => ({
      id: p.id,
      scheduled_at: p.scheduled_at,
      status: p.status,
      caption: p.caption,
      content_angle_variant: p.content_angle_variant,
      product_name: (p.product_id && productNameById.get(p.product_id)) || "(sản phẩm?)",
      campaign_name: p.campaign_id ? campaignNameById.get(p.campaign_id) ?? null : null,
    }));
  }, []);

  // --- Đếm ---
  const todayCount = await safe(async () => {
    const { count } = await supabase
      .from("generated_posts")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_at", todayStart)
      .lt("scheduled_at", todayEnd);
    return count ?? todayPosts.length;
  }, todayPosts.length);

  const failed24h = await safe(async () => {
    const { count } = await supabase
      .from("posting_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "FAILED")
      .gte("created_at", last24h);
    return count ?? 0;
  }, 0);

  const needLink = await safe(async () => {
    const { count } = await supabase
      .from("sourcing_candidates")
      .select("id", { count: "exact", head: true })
      .in("status", ["NEW", "SOURCING"]);
    return count ?? 0;
  }, 0);

  const draftPlans = await safe(async () => {
    const { count } = await supabase
      .from("ai_campaign_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("status", "DRAFT");
    return count ?? 0;
  }, 0);

  const upcoming = todayPosts.filter(
    (p) => p.status === "READY" && p.scheduled_at !== null && p.scheduled_at >= nowIso,
  ).length;
  const publishedToday = todayPosts.filter((p) => p.status === "PUBLISHED").length;

  // --- Sourcing snapshot ---
  const sourcing = await safe(async () => {
    const { data } = await supabase
      .from("sourcing_candidates")
      .select("id, suggested_product, priority, confidence, status, suggested_search_keywords")
      .in("status", ["NEW", "SOURCING"])
      .order("created_at", { ascending: false })
      .limit(10);
    return ((data ?? []) as Array<Record<string, unknown>>).map<OpsSourcing>((c) => ({
      id: String(c.id),
      suggested_product: String(c.suggested_product ?? ""),
      priority: (c.priority as string | null) ?? null,
      confidence: (c.confidence as string | null) ?? null,
      status: String(c.status ?? "NEW"),
      keyword: firstKeyword(c.suggested_search_keywords),
    }));
  }, []);

  // --- Campaign đang chạy ---
  const campaigns: OpsCampaign[] = campaignsAll
    .filter((c) => c.status === "ACTIVE")
    .slice(0, 10)
    .map((c) => {
      const s = statsByCampaign.get(c.id) ?? { total: 0, ready: 0, published: 0, failed: 0 };
      return { id: c.id, name: c.name, start_at: c.start_at, end_at: c.end_at, ...s };
    });

  // --- AI planner snapshot ---
  const recommendations = await safe(async () => {
    const { data } = await supabase
      .from("ai_campaign_recommendations")
      .select("id, title, planner_mode, goal, status, created_at, updated_at")
      .in("status", ["DRAFT", "APPROVED", "RUNNING", "FAILED"])
      .order("created_at", { ascending: false })
      .limit(5);
    return ((data ?? []) as Array<Record<string, unknown>>).map<OpsRec>((r) => ({
      id: String(r.id),
      title: String(r.title ?? "Gợi ý"),
      planner_mode: (r.planner_mode as string | null) ?? null,
      goal: (r.goal as string | null) ?? null,
      status: String(r.status ?? "DRAFT"),
      created_at: String(r.created_at ?? ""),
      stuck: r.status === "RUNNING" && typeof r.created_at === "string" && r.created_at < tenMinAgo,
    }));
  }, []);

  // --- Lỗi gần đây ---
  const errors = await safe(async () => {
    const { data } = await supabase
      .from("posting_logs")
      .select("id, created_at, action, message, status")
      .eq("status", "FAILED")
      .order("created_at", { ascending: false })
      .limit(10);
    return ((data ?? []) as Array<Record<string, unknown>>).map<OpsLog>((l) => ({
      id: String(l.id),
      created_at: String(l.created_at ?? ""),
      action: (l.action as string | null) ?? null,
      message: (l.message as string | null) ?? null,
    }));
  }, []);

  // --- Việc cần làm (rule-based) ---
  const tasks: OpsTask[] = [];
  const failedToday = todayPosts.filter((p) => p.status === "FAILED").length;
  const rejectedToday = todayPosts.filter((p) => p.status === "REJECTED").length;
  const missingCaptionToday = todayPosts.filter(
    (p) => p.status !== "FAILED" && p.status !== "REJECTED" && !(p.caption && p.caption.trim()),
  ).length;
  const stuckJobs = recommendations.filter((r) => r.stuck).length;
  const fbFailLogs = errors.filter((e) => (e.action ?? "").toUpperCase().includes("PUBLISH")).length;

  if (failedToday > 0)
    tasks.push({ priority: "HIGH", title: `${failedToday} bài đăng lỗi hôm nay`, reason: "Bài có trạng thái FAILED.", action: "Mở Bài đăng để retry.", href: "/dashboard/posts" });
  if (fbFailLogs > 0)
    tasks.push({ priority: "HIGH", title: `${fbFailLogs} lỗi đăng Facebook gần đây`, reason: "Log publish có FAILED.", action: "Kiểm tra log & token.", href: "/dashboard/logs" });
  if (missingCaptionToday > 0)
    tasks.push({ priority: "HIGH", title: `${missingCaptionToday} bài hôm nay thiếu caption`, reason: "Bài lên lịch nhưng chưa có nội dung.", action: "Kiểm tra & tạo lại caption.", href: "/dashboard/posts" });
  if (rejectedToday > 0)
    tasks.push({ priority: "HIGH", title: `${rejectedToday} bài hôm nay bị từ chối`, reason: "AI score thấp (REJECTED).", action: "Xem & duyệt/tạo lại.", href: "/dashboard/posts" });
  if (stuckJobs > 0)
    tasks.push({ priority: "HIGH", title: `${stuckJobs} job AI có thể bị treo`, reason: "Đang RUNNING quá 10 phút.", action: "Mở gợi ý & đánh dấu thất bại.", href: "/dashboard/ai-planner" });

  if (needLink > 0)
    tasks.push({ priority: "MEDIUM", title: `${needLink} sản phẩm cần tìm link`, reason: "Sourcing đang NEW/SOURCING.", action: "Tìm link & convert sản phẩm.", href: "/dashboard/manual-tools?tab=sourcing" });
  if (draftPlans > 0)
    tasks.push({ priority: "MEDIUM", title: `${draftPlans} gợi ý AI chờ duyệt`, reason: "Recommendation đang DRAFT.", action: "Mở & duyệt gợi ý.", href: "/dashboard/ai-planner" });
  const activeNoPosts = campaigns.filter((c) => c.total === 0).length;
  if (activeNoPosts > 0)
    tasks.push({ priority: "MEDIUM", title: `${activeNoPosts} campaign chưa có bài`, reason: "Campaign ACTIVE nhưng 0 bài.", action: "Kiểm tra campaign.", href: "/dashboard/campaigns" });

  const readyProducts = products.filter((p) => p.status === "ACTIVE" && p.link_status === "READY");
  const readyUnused = readyProducts.filter((p) => !usedProductIds.has(p.id)).length;
  if (readyUnused > 0)
    tasks.push({ priority: "LOW", title: `${readyUnused} sản phẩm READY chưa dùng`, reason: "Chưa có bài nào dùng sản phẩm này.", action: "Tạo campaign dùng sản phẩm.", href: "/dashboard/campaigns" });
  const missingSubId = readyProducts.filter((p) => !(p.sub_id && p.sub_id.trim())).length;
  if (missingSubId > 0)
    tasks.push({ priority: "LOW", title: `${missingSubId} sản phẩm thiếu sub_id`, reason: "Khó đo lường hiệu quả.", action: "Bổ sung sub_id trong Sản phẩm.", href: "/dashboard/products" });

  return {
    todayStart,
    todayEnd,
    counts: { today: todayCount, upcoming, published: publishedToday, failed24h, needLink, draftPlans },
    todayPosts,
    tasks,
    sourcing,
    campaigns,
    recommendations,
    errors,
  };
}
