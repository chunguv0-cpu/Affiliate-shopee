import AffiliateReportImportForm from "@/components/dashboard/AffiliateReportImportForm";
import PageHeader from "@/components/dashboard/PageHeader";

export const dynamic = "force-dynamic";

export default function AnalyticsImportPage() {
  return (
    <div>
      <PageHeader
        title="Import báo cáo Affiliate"
        description="Dán CSV báo cáo từ Shopee Affiliate. App đọc click, đơn, hoa hồng và map theo sub_id / affiliate_link."
      />
      <AffiliateReportImportForm />
    </div>
  );
}
