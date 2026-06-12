import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Phase 20 — route cũ đã gộp vào "Công cụ thủ công". */
export default function ImportLinksPage() {
  redirect("/dashboard/manual-tools?tab=import");
}
