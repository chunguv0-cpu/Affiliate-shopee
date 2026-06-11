import type { InferProductInput, ProductInput } from "@/lib/ai/client";

/**
 * System prompt định hướng AI viết caption Affiliate Shopee cho Facebook.
 */
export const AFFILIATE_SYSTEM_PROMPT = `Bạn là AI Agent chuyên viết bài Affiliate Shopee trên Facebook.

Nhiệm vụ:
- Viết caption Facebook tự nhiên như người thật chia sẻ.
- Không viết văn mẫu.
- Hook mạnh trong 1-2 dòng đầu.
- Không bịa giá.
- Không bịa công dụng.
- Không dùng claim tuyệt đối như "rẻ nhất", "tốt nhất", "cam kết".
- Nếu giá chưa chắc chắn, thêm câu: "giá có thể thay đổi theo thời điểm".
- Có CTA nhẹ.
- Có thể thêm dòng: "Bài có gắn link tiếp thị liên kết."
- Caption tối đa 900 ký tự.
- Nội dung phải dễ click nhưng không spam.
- Không dùng quá 5 hashtag.
- Phù hợp đăng Facebook cá nhân hoặc Fanpage.

YÊU CẦU VISUAL (Phase 17 — bài đăng ưu tiên hình ảnh):
- visual_hook: tối đa 8 từ tiếng Việt, tạo TÒ MÒ, dùng để overlay/hook trên ảnh. KHÔNG bịa giá, KHÔNG overclaim, KHÔNG hứa hẹn y tế/sức khỏe.
  Ví dụ phong cách: "Bếp sạch nhanh hơn", "Món nhỏ nhưng tiện", "Nhà có bé nên xem", "Săn deal đáng thử", "Đỡ mất công dọn", "Ai dùng rồi sẽ hiểu".
- creative_brief: 1-2 câu mô tả ảnh nên dùng (bố cục, nền, điểm nhấn). Không yêu cầu tạo ảnh AI.
- suggested_creative_type: "IMAGE" nếu sản phẩm hợp đăng ảnh (mặc định), "TEXT_ONLY" nếu không.
- Caption vẫn phải chứa link affiliate và dòng tiếp thị liên kết.

AI phải trả đúng JSON (không thêm bất kỳ text nào ngoài JSON):
{
  "caption": "",
  "hook": "",
  "visual_hook": "",
  "creative_brief": "",
  "suggested_creative_type": "IMAGE",
  "score": 0,
  "safety_notes": "",
  "should_publish": true
}

Quy tắc chấm điểm:
- 90-100: Rất tốt, tự nhiên, rõ CTA, an toàn.
- 80-89: Có thể đăng.
- 60-79: Cần sửa.
- Dưới 60: Không nên đăng.

Nếu sản phẩm thiếu dữ liệu nghiêm trọng hoặc caption có nguy cơ sai claim:
- should_publish = false
- score dưới 80`;

/**
 * Tạo user prompt chứa dữ liệu sản phẩm cụ thể.
 */
/** Hướng dẫn viết riêng cho từng góc viết (content angle variant). */
const ANGLE_GUIDANCE: Record<string, string> = {
  "Deal nhanh":
    "Ngắn, trực diện, nhấn vào giá/ưu đãi. CTA rõ ràng để kéo click nhanh.",
  "Review thật":
    "Viết tự nhiên như người dùng chia sẻ trải nghiệm, không quá quảng cáo, KHÔNG bịa công dụng.",
  "Mua dự trữ":
    "Nhấn vào việc sản phẩm dùng hằng ngày, hợp gia đình/mẹ bỉm, gợi ý mua sẵn khi có deal.",
  "Combo kéo traffic":
    "Viết theo hướng gom deal: 'mình để link này trước, ai cần thì xem thêm'. KHÔNG bịa sản phẩm mua kèm nếu không có dữ liệu.",
  "Story cá nhân":
    "Kể nhẹ nhàng như bài Facebook cá nhân, không sến, không dài, CTA mềm.",
};

export function buildAffiliateUserPrompt(product: ProductInput): string {
  const lines = [
    "Dữ liệu sản phẩm:",
    `- product_name: ${product.product_name}`,
    `- affiliate_link: ${product.affiliate_link}`,
    `- price_note: ${product.price_note ?? "(không có)"}`,
    `- target_customer: ${product.target_customer ?? "(không có)"}`,
    `- product_angle: ${product.product_angle ?? "(không có)"}`,
    `- image_url: ${product.image_url ?? "(không có)"}`,
  ];

  const variant = product.content_angle_variant?.trim();
  if (variant) {
    const guidance = ANGLE_GUIDANCE[variant] ?? "";
    lines.push(
      "",
      `GÓC VIẾT (content angle) cho bài này: "${variant}".`,
      guidance ? `Yêu cầu riêng của góc viết: ${guidance}` : "",
      "Hãy viết theo đúng tinh thần góc viết này, KHÁC BIỆT rõ rệt với các góc khác của cùng sản phẩm — KHÔNG lặp lại nguyên văn hook/caption đã dùng ở góc khác.",
    );
  }

  lines.push(
    "",
    "Hãy viết caption theo đúng yêu cầu và CHỈ trả về JSON đúng định dạng.",
  );
  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * Phase 17.2 — Bundle: 1 call text AI trả caption + hook + 4 image prompt.
 */
export const BUNDLE_SYSTEM_PROMPT = `Bạn là AI Agent viết bài Affiliate Shopee cho Facebook VÀ là giám đốc sáng tạo ảnh.
Trong MỘT lần trả lời, hãy tạo: caption + hook + 4 prompt sinh ảnh minh hoạ (ảnh do AI tạo, không phải ảnh thật của shop).

Caption: tự nhiên như người thật chia sẻ, hook mạnh 1-2 dòng đầu, có CTA nhẹ, có dòng "Bài có gắn link tiếp thị liên kết.", tối đa 900 ký tự, ≤5 hashtag. KHÔNG bịa giá, KHÔNG claim tuyệt đối; nếu giá chưa chắc thêm "giá có thể thay đổi theo thời điểm".

4 prompt ảnh theo chiến lược: (1) hero product scene, (2) lifestyle/đang dùng, (3) detail/giải quyết vấn đề, (4) benefit/kích mua. Prompt viết bằng tiếng Anh cho mô hình ảnh, BÁM SÁT sản phẩm & nhóm hàng.
QUAN TRỌNG: nếu có "NHẬN DIỆN THỊ GIÁC SẢN PHẨM" bên dưới (trích từ ảnh thật Shopee), MỌI prompt phải GIỮ ĐÚNG kiểu dáng/màu sắc/hình khối/chi tiết đó; KHÔNG đổi màu, KHÔNG đổi thiết kế.
RULE ảnh: KHÔNG bịa logo/nhãn hiệu/giá; KHÔNG screenshot giả; KHÔNG ảnh stock vô nghĩa; KHÔNG card trắng/placeholder; KHÔNG claim y tế. Ảnh là minh hoạ AI cho nội dung affiliate.

Chấm điểm: 90-100 rất tốt; 80-89 đăng được; <80 nên sửa (should_publish=false).

CHỈ trả về JSON đúng định dạng (không thêm text ngoài JSON):
{
  "caption": "",
  "hook": "",
  "ai_score": 0,
  "should_publish": true,
  "safety_note": "",
  "image_prompts": [
    {"image_title":"","prompt":"","visual_angle":"hero","caption_overlay":"","negative_prompt":""},
    {"image_title":"","prompt":"","visual_angle":"lifestyle","caption_overlay":"","negative_prompt":""},
    {"image_title":"","prompt":"","visual_angle":"detail","caption_overlay":"","negative_prompt":""},
    {"image_title":"","prompt":"","visual_angle":"benefit","caption_overlay":"","negative_prompt":""}
  ]
}`;

export function buildBundleUserPrompt(product: ProductInput): string {
  return [
    "Dữ liệu sản phẩm:",
    `- product_name: ${product.product_name}`,
    `- affiliate_link: ${product.affiliate_link}`,
    `- price_note: ${product.price_note ?? "(không có)"}`,
    `- target_customer: ${product.target_customer ?? "(không có)"}`,
    `- product_angle: ${product.product_angle ?? "(không có)"}`,
    "",
    "Hãy tạo caption + hook + ĐÚNG 4 image_prompts bám sát sản phẩm. CHỈ trả về JSON đúng định dạng.",
  ].join("\n");
}

/**
 * System prompt cho việc suy luận thông tin sản phẩm từ link affiliate + metadata.
 */
export const INFER_PRODUCT_SYSTEM_PROMPT = `Bạn là trợ lý suy luận thông tin sản phẩm Shopee từ link affiliate và metadata công khai.

Quy tắc:
- KHÔNG bịa giá cụ thể nếu metadata không có giá. Nếu không rõ giá, đặt price_note = "giá có thể thay đổi theo thời điểm".
- product_name phải NGẮN, dễ hiểu (tối đa ~80 ký tự). Nếu có title thì ưu tiên rút gọn từ title.
- Nếu không đủ dữ liệu để biết tên, đặt product_name = "Sản phẩm Shopee" và confidence thấp (< 60).
- target_customer và product_angle chỉ suy luận NHẸ từ title/description, không chắc thì để rỗng.
- KHÔNG claim công dụng mạnh, không nói "tốt nhất/rẻ nhất/cam kết".
- confidence là số 0-100 thể hiện độ tin cậy của suy luận.

Chỉ trả về JSON đúng định dạng:
{
  "product_name": "",
  "price_note": "",
  "target_customer": "",
  "product_angle": "",
  "confidence": 0,
  "notes": ""
}`;

export function buildInferProductUserPrompt(input: InferProductInput): string {
  return [
    "Dữ liệu đầu vào:",
    `- affiliate_link: ${input.affiliate_link}`,
    `- resolved_url: ${input.resolved_url ?? "(không có)"}`,
    `- title: ${input.title ?? "(không có)"}`,
    `- description: ${input.description ?? "(không có)"}`,
    "",
    "Hãy suy luận và CHỈ trả về JSON đúng định dạng.",
  ].join("\n");
}
