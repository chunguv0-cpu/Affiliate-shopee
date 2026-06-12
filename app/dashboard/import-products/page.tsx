import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Phase 20 — đã gộp vào "Công cụ thủ công". Giữ route để tương thích ngược. */
export default function ImportProductsPage() {
  redirect("/dashboard/manual-tools?tab=import");
}
