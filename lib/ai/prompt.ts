import type { ProductInput } from "@/lib/ai/client";

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

AI phải trả đúng JSON (không thêm bất kỳ text nào ngoài JSON):
{
  "caption": "",
  "hook": "",
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
export function buildAffiliateUserPrompt(product: ProductInput): string {
  const lines = [
    "Dữ liệu sản phẩm:",
    `- product_name: ${product.product_name}`,
    `- affiliate_link: ${product.affiliate_link}`,
    `- price_note: ${product.price_note ?? "(không có)"}`,
    `- target_customer: ${product.target_customer ?? "(không có)"}`,
    `- product_angle: ${product.product_angle ?? "(không có)"}`,
    `- image_url: ${product.image_url ?? "(không có)"}`,
    "",
    "Hãy viết caption theo đúng yêu cầu và CHỈ trả về JSON đúng định dạng.",
  ];
  return lines.join("\n");
}
