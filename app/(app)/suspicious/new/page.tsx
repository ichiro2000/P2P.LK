import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { Reveal } from "@/components/common/reveal";
import { AddReportForm } from "@/components/suspicious/add-report-form";

export const metadata = { title: "Add Suspicious Report" };
export const dynamic = "force-dynamic";

export default function NewSuspiciousPage() {
  return (
    <>
      <Topbar title="Add report" subtitle="Flag a suspicious taker" />

      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="New report"
          title="Submit a suspicious taker"
          description="Upload the Binance Share-Profile QR, pick a reason, and add any evidence you have. The report is published to the community registry immediately."
        />

        <Reveal>
          <AddReportForm />
        </Reveal>
      </div>
    </>
  );
}
