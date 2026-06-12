import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Phase 20 — "Gợi ý AI" đã được gộp vào AI Autopilot để tránh trùng workflow. */
export default function AiPlannerPage() {
  redirect("/dashboard/ai-autopilot");
}
