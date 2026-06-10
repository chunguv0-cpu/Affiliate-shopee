/**
 * Sinh truy vấn nghiên cứu thị trường (Phase 13.1) — thuần, không gọi AI.
 * Tập trung xu hướng mua sắm, nhu cầu khách, cách chọn, review, hook FB/TikTok.
 * KHÔNG tạo query nhạy cảm / hack / scrape / coupon lừa đảo.
 */

export type QueryGenInput = {
  products: Array<{
    product_name: string;
    target_customer?: string | null;
    product_angle?: string | null;
  }>;
  goal: "clicks" | "orders" | "commission" | "engagement" | "balanced";
  target_customer?: string | null;
  notes?: string | null;
  /** Phase 13.3 — chế độ lập kế hoạch (ảnh hưởng query khám phá sản phẩm). */
  planner_mode?: "HYBRID" | "EXISTING_ONLY" | "DISCOVERY_ONLY" | null;
};

// Phase 13.3 — query khám phá sản phẩm mới theo mục tiêu.
const DISCOVERY_QUERIES: Record<string, string[]> = {
  orders: [
    "sản phẩm dễ ra đơn affiliate shopee",
    "đồ gia dụng thiết yếu dễ mua online",
    "sản phẩm mẹ bỉm mua lặp lại",
    "sản phẩm dưới 99k dễ bán online",
    "mặt hàng tiêu dùng mua lặp lại trên shopee",
    "sản phẩm affiliate dễ bán facebook",
    "sản phẩm giải quyết vấn đề hằng ngày",
    "đồ tiện ích gia đình đáng mua",
    "mẹ và bé sản phẩm thiết yếu nên mua",
  ],
  engagement: [
    "sản phẩm lạ dễ viral facebook",
    "đồ gia dụng thông minh gây tò mò",
    "sản phẩm trend tiktok shopee",
    "sản phẩm dễ kéo comment facebook",
  ],
};

export function generateResearchQueries(input: QueryGenInput): string[] {
  const queries: string[] = [];
  const add = (q: string) => {
    const t = q.trim();
    if (t && !queries.includes(t)) queries.push(t);
  };

  // 1) Nền tảng: xu hướng + cách viết nội dung.
  add("xu hướng mua sắm shopee tuần này");
  add("cách viết bài affiliate shopee kéo tương tác facebook");
  add("hook facebook bán hàng affiliate phổ biến");
  add("kinh nghiệm săn sale shopee đáng mua");

  // 2) Theo tệp khách.
  const audience = input.target_customer?.trim();
  if (audience) {
    add(`${audience} nên mua gì khi săn sale shopee`);
    add(`sản phẩm ${audience} quan tâm mua online`);
  }

  // 3) Theo mục tiêu.
  if (input.goal === "engagement") {
    add("cách tạo bài facebook nhiều bình luận lưu bài");
  } else if (input.goal === "commission") {
    add("nhóm sản phẩm affiliate shopee hoa hồng cao bán chạy");
  } else if (input.goal === "orders") {
    // Tập trung chuyển đổi / dễ ra đơn (Phase 13.2).
    add("sản phẩm dễ mua online thiết yếu shopee");
    add("đồ gia dụng thiết yếu nên mua lại online");
    add("sản phẩm mẹ bỉm mua nhiều trên shopee");
    add("cách viết bài affiliate tăng đơn hàng facebook");
    add("sản phẩm dưới 99k dễ mua shopee");
    add("mặt hàng tiêu dùng mua lặp lại online");
    add("câu hỏi khiến người mua ra quyết định mua hàng");
  } else if (input.goal === "clicks") {
    add("tiêu đề kéo click bài affiliate facebook");
  }

  // 3.5) Phase 13.3 — query khám phá sản phẩm mới (HYBRID / DISCOVERY_ONLY).
  const mode = input.planner_mode ?? "HYBRID";
  if (mode === "DISCOVERY_ONLY" || mode === "HYBRID") {
    const discovery = DISCOVERY_QUERIES[input.goal] ?? DISCOVERY_QUERIES.orders;
    // DISCOVERY_ONLY ưu tiên nhiều query khám phá; HYBRID thêm vừa phải.
    const take = mode === "DISCOVERY_ONLY" ? discovery.length : 4;
    for (const q of discovery.slice(0, take)) add(q);
  }

  // 4) Theo sản phẩm (bỏ qua khi DISCOVERY_ONLY vì không dựa vào kho).
  if (mode !== "DISCOVERY_ONLY") {
    for (const p of input.products.slice(0, 5)) {
      const name = p.product_name.trim();
      if (!name) continue;
      add(`${name} review kinh nghiệm nên mua loại nào`);
      add(`${name} có đáng mua không shopee`);
      if (queries.length >= 15) break;
    }
  }

  // 5) Nhóm hàng phổ biến (nếu còn chỗ).
  add("đồ gia dụng thông minh đáng mua shopee");
  add("sản phẩm mẹ và bé bán chạy online");

  return queries.slice(0, 15);
}
