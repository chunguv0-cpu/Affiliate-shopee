import type { GeneratedCaptionResult } from "@/lib/ai/client";

/**
 * Trích phần JSON đầu tiên từ chuỗi trả về của AI.
 * Hỗ trợ trường hợp AI bọc trong code fence ```json ... ``` hoặc kèm text thừa.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Bỏ code fence nếu có.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Lấy từ dấu { đầu tiên đến dấu } cuối cùng.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return candidate;
  }
  return candidate.slice(start, end + 1);
}

/**
 * Phân tích an toàn JSON do AI trả về thành GeneratedCaptionResult.
 *
 * - Trích JSON đầu tiên nếu có text thừa.
 * - Ném lỗi rõ ràng nếu không parse được.
 * - Chuẩn hóa các field về đúng kiểu; dữ liệu xấu -> giá trị an toàn.
 */
export function safeParseAIJson(raw: string): GeneratedCaptionResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("AI không trả về nội dung nào để phân tích.");
  }

  const jsonText = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Không phân tích được JSON từ phản hồi của AI.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Phản hồi của AI không phải là một đối tượng JSON hợp lệ.");
  }

  const obj = parsed as Record<string, unknown>;

  const caption = typeof obj.caption === "string" ? obj.caption.trim() : "";
  const hook = typeof obj.hook === "string" ? obj.hook : "";
  const safety_notes =
    typeof obj.safety_notes === "string" ? obj.safety_notes : "";

  // score: phải là number hữu hạn, ngược lại = 0.
  let score =
    typeof obj.score === "number" && Number.isFinite(obj.score) ? obj.score : 0;

  // should_publish: phải là boolean, ngược lại = false.
  let should_publish =
    typeof obj.should_publish === "boolean" ? obj.should_publish : false;

  // caption không hợp lệ/rỗng -> không nên đăng, score = 0.
  if (caption === "") {
    should_publish = false;
    score = 0;
  }

  // Phase 17 — visual fields (an toàn, có default).
  let visual_hook = typeof obj.visual_hook === "string" ? obj.visual_hook.trim() : "";
  // Giới hạn ~8 từ để giữ ngắn gọn.
  if (visual_hook) visual_hook = visual_hook.split(/\s+/).slice(0, 8).join(" ");
  const creative_brief = typeof obj.creative_brief === "string" ? obj.creative_brief.trim() : "";
  const sct = typeof obj.suggested_creative_type === "string" ? obj.suggested_creative_type.toUpperCase() : "";
  const suggested_creative_type: GeneratedCaptionResult["suggested_creative_type"] =
    sct === "IMAGE" || sct === "VIDEO" ? (sct as "IMAGE" | "VIDEO") : "TEXT_ONLY";

  return {
    caption,
    hook,
    score,
    safety_notes,
    should_publish,
    visual_hook,
    creative_brief,
    suggested_creative_type,
  };
}
