import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import { getOverviewStats } from "@/app/dashboard/posts/actions";

// Luôn đọc số liệu mới từ database.
export const dynamic = "force-dynamic";

export default async function DashboardOverviewPage() {
  const stats = await getOverviewStats();

  const cards = [
    { label: "Tổng sản phẩm", value: stats.totalProducts, icon: "🛍️", accent: "blue" as const, hint: "Tất cả sản phẩm affiliate" },
    { label: "Sẵn sàng", value: stats.ready, icon: "✅", accent: "green" as const, hint: "Bài AI trạng thái READY" },
    { label: "Đang đăng", value: stats.publishing, icon: "⏳", accent: "blue" as const, hint: "Bài đang được xử lý đăng" },
    { label: "Đã đăng", value: stats.published, icon: "📣", accent: "green" as const, hint: "Bài AI trạng thái PUBLISHED" },
    { label: "Lỗi", value: stats.failed, icon: "⚠️", accent: "red" as const, hint: "Bài AI trạng thái FAILED" },
    { label: "Đến hạn đăng", value: stats.due, icon: "🔔", accent: "amber" as const, hint: "Bài READY đã tới giờ đăng" },
  ];

  return (
    <div>
      <PageHeader
        title="Tổng quan"
        description="Bảng điều khiển tổng quan hệ thống tự động đăng bài affiliate."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            icon={c.icon}
            accent={c.accent}
            hint={c.hint}
          />
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-base font-semibold text-gray-900">
          Chào mừng đến với Affiliate Agent 👋
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          Số liệu phía trên được lấy trực tiếp từ cơ sở dữ liệu. Vào mục{" "}
          <strong>Sản phẩm</strong> để thêm sản phẩm và bấm{" "}
          <strong>Tạo bài AI</strong>; bài tạo ra sẽ xuất hiện ở mục{" "}
          <strong>Bài đăng</strong>. Tính năng đăng Facebook và lịch đăng sẽ có ở
          các phase tiếp theo.
        </p>
      </div>
    </div>
  );
}
