import Link from "next/link";

import FacebookPageManager from "@/components/dashboard/FacebookPageManager";
import PageHeader from "@/components/dashboard/PageHeader";
import ShopeeAccountManager from "@/components/dashboard/ShopeeAccountManager";
import { getFacebookPages } from "@/app/dashboard/accounts/facebook-actions";
import { getShopeeAccounts } from "@/app/dashboard/shopee-accounts/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "shopee", label: "Tài khoản Shopee" },
  { key: "facebook", label: "Facebook Pages" },
  { key: "diagnostics", label: "Kiểm tra API" },
  { key: "logs", label: "Nhật ký kết nối" },
];

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.key === tab)?.key ?? "shopee";

  return (
    <div>
      <PageHeader
        title="Tài khoản & Page"
        description="Quản lý nhiều tài khoản Shopee (API riêng) và nhiều Facebook Page. Chọn tài khoản + Page cho từng chiến dịch ở AI Autopilot. Token chỉ lưu server, hiển thị dạng che."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/accounts?tab=${t.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              t.key === active ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {active === "shopee" ? <ShopeeTab /> : null}
      {active === "facebook" ? <FacebookTab /> : null}
      {active === "diagnostics" ? <DiagnosticsTab /> : null}
      {active === "logs" ? <ConnectionLogsTab /> : null}
    </div>
  );
}

async function ShopeeTab() {
  const res = await getShopeeAccounts();
  const accounts = res.ok ? res.accounts : [];
  return (
    <div>
      {!res.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {res.error}
          <p className="mt-1 text-red-600">Kiểm tra đã chạy migration <code>add_shopee_accounts.sql</code> chưa.</p>
        </div>
      ) : null}
      <ShopeeAccountManager accounts={accounts} />
    </div>
  );
}

async function FacebookTab() {
  const res = await getFacebookPages();
  const pages = res.ok ? res.pages : [];
  return (
    <div>
      {!res.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {res.error}
          <p className="mt-1 text-red-600">Kiểm tra đã chạy migration <code>add_master_repair.sql</code> chưa.</p>
        </div>
      ) : null}
      <FacebookPageManager pages={pages} />
    </div>
  );
}

async function DiagnosticsTab() {
  const [shopeeRes, fbRes] = await Promise.all([getShopeeAccounts(), getFacebookPages()]);
  const shopeeCount = shopeeRes.ok ? shopeeRes.accounts.filter((a) => a.status === "ACTIVE").length : 0;
  const fbCount = fbRes.ok ? fbRes.pages.filter((p) => p.status === "ACTIVE").length : 0;
  const envFb = Boolean(process.env.FACEBOOK_PAGE_ID?.trim() && process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim());
  const cronSecret = Boolean(process.env.CRON_SECRET?.trim());

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
        <h3 className="mb-3 text-base font-semibold text-gray-900">Tình trạng kết nối</h3>
        <ul className="space-y-2 text-gray-700">
          <li>🔑 Tài khoản Shopee ACTIVE: <strong>{shopeeCount}</strong></li>
          <li>📘 Facebook Page ACTIVE: <strong>{fbCount}</strong></li>
          <li>🧩 Env Facebook fallback (FACEBOOK_PAGE_ID/TOKEN): <strong>{envFb ? "Đã cấu hình" : "Chưa"}</strong></li>
          <li>⏱️ CRON_SECRET: <strong>{cronSecret ? "Đã cấu hình" : "Chưa"}</strong></li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Dùng nút <strong>Kiểm tra</strong> ở tab Shopee/Facebook để test API từng tài khoản/Page. Trạng thái cron Autopilot xem ở mục
          <Link href="/dashboard/ai-autopilot" className="ml-1 text-blue-600 underline">AI Autopilot</Link> hoặc gọi <code>/api/debug/autopilot-status</code>.
        </p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
        Provider tìm sản phẩm dùng tài khoản Shopee đã chọn cho từng chiến dịch (fallback tài khoản mặc định). Đăng bài dùng Page đã chọn → Page mặc định → env fallback.
      </div>
    </div>
  );
}

async function ConnectionLogsTab() {
  const actions = [
    "SHOPEE_ACCOUNT_SELECTED",
    "FACEBOOK_PAGE_SELECTED",
    "FACEBOOK_PAGE_TOKEN_MISSING",
    "SHOPEE_ACCOUNT_TOKEN_MISSING",
    "FACEBOOK_PUBLISH_SUCCESS",
    "FACEBOOK_PHOTO_PUBLISH_SUCCESS",
    "FACEBOOK_ALBUM_PUBLISH_SUCCESS",
    "AUTOPILOT_FAILED_RECOVERABLE",
    "AUTOPILOT_FAILED_NON_RECOVERABLE",
  ];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("posting_logs")
      .select("id, action, status, message, created_at")
      .in("action", actions)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) {
      return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error.message}</div>;
    }
    const rows = (data ?? []) as Array<{ id: string; action: string | null; status: string | null; message: string | null; created_at: string | null }>;
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">Nhật ký kết nối gần đây</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có log kết nối nào. Các lỗi/chạy thử Shopee, Facebook và autopilot sẽ xuất hiện ở đây.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Thời gian</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Thông báo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{r.created_at ? new Date(r.created_at).toLocaleString("vi-VN") : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.action ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.status ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">Log này không hiển thị token, API key, secret hoặc raw response.</p>
      </div>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
  }
}
