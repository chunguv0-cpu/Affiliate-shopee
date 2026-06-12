import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Route cũ được gộp vào "Tài khoản & Page". */
export default function ShopeeAccountsPage() {
  redirect("/dashboard/accounts?tab=shopee");
}
