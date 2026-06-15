"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
};

/**
 * Danh sách điều hướng CHÍNH (Phase 20 — gọn gàng, 1 workflow rõ ràng).
 * AI Autopilot là điểm bắt đầu chính. Các công cụ thủ công gộp vào "Công cụ thủ công".
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Tổng quan", href: "/dashboard", icon: "📊" },
  { label: "AI Autopilot", href: "/dashboard/ai-autopilot", icon: "🤖" },
  { label: "Chờ duyệt bài", href: "/dashboard/review", icon: "✅" },
  { label: "Lịch đăng", href: "/dashboard/calendar", icon: "🗓️" },
  { label: "Hiệu quả", href: "/dashboard/analytics", icon: "📈" },
  { label: "Sản phẩm", href: "/dashboard/products", icon: "🛍️" },
  { label: "Công cụ thủ công", href: "/dashboard/manual-tools", icon: "🧰" },
  { label: "Tài khoản & Page", href: "/dashboard/accounts", icon: "🔑" },
  { label: "Cấu hình", href: "/dashboard/settings", icon: "⚙️" },
  { label: "Logs", href: "/dashboard/logs", icon: "📜" },
];

/** Mục phụ (vẫn truy cập được, không phải workflow chính). */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { label: "Bài đăng", href: "/dashboard/posts", icon: "📝" },
  { label: "Hàng đợi AI Jobs", href: "/dashboard/jobs", icon: "🧵" },
  { label: "Chiến dịch", href: "/dashboard/campaigns", icon: "🚀" },
  { label: "Vận hành hôm nay", href: "/dashboard/ops", icon: "🎯" },
];

type SidebarProps = {
  /** Trạng thái mở sidebar trên mobile. */
  open: boolean;
  /** Đóng sidebar (mobile) sau khi chọn một mục. */
  onClose: () => void;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Lớp phủ mờ trên mobile khi mở sidebar */}
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-base shadow-sm shadow-blue-600/30">
            🤖
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-slate-900">Affiliate Agent</div>
            <div className="text-[11px] font-medium text-slate-400">Shopee Auto · AI</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-blue-600" aria-hidden="true" />
                ) : null}
                <span className={`text-lg transition-transform group-hover:scale-110 ${active ? "" : "grayscale-[35%] group-hover:grayscale-0"}`} aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}

          <div className="mt-4 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Khác
          </div>
          {SECONDARY_NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all ${
                  active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-blue-600" aria-hidden="true" />
                ) : null}
                <span className="text-base transition-transform group-hover:scale-110" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-slate-500">Hệ thống đang hoạt động</span>
          </div>
        </div>
      </aside>
    </>
  );
}
