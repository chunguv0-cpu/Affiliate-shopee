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
    add("sản phẩm shopee dễ chốt đơn khi có deal");
  } else if (input.goal === "clicks") {
    add("tiêu đề kéo click bài affiliate facebook");
  }

  // 4) Theo sản phẩm (tối đa 5 sản phẩm đầu).
  for (const p of input.products.slice(0, 5)) {
    const name = p.product_name.trim();
    if (!name) continue;
    add(`${name} review kinh nghiệm nên mua loại nào`);
    add(`${name} có đáng mua không shopee`);
    if (queries.length >= 15) break;
  }

  // 5) Nhóm hàng phổ biến (nếu còn chỗ).
  add("đồ gia dụng thông minh đáng mua shopee");
  add("sản phẩm mẹ và bé bán chạy online");

  return queries.slice(0, 15);
}
