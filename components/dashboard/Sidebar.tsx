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
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-gray-200 bg-white transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
          <span className="text-xl">🤖</span>
          <span className="text-base font-semibold text-gray-900">
            Affiliate Agent
          </span>
        </div>

        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className="text-lg" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}

          <div className="mt-3 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Khác
          </div>
          {SECONDARY_NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                <span className="text-base" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
