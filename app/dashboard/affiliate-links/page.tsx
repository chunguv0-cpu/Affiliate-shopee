import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Phase 20 — đã gộp vào "Công cụ thủ công". Giữ route để tương thích ngược. */
export default function AffiliateLinksPage() {
  redirect("/dashboard/manual-tools?tab=affiliate-links");
}
