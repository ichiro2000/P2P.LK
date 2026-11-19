import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { MembersTeaser } from "@/components/members/members-teaser";
import { ReportWorkspace } from "@/components/suspicious/report-workspace";
import { getViewer, isAdmin, isMember } from "@/lib/auth/session";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Add a suspicious taker report", "follow");
export const dynamic = "force-dynamic";

const backLink = (
  <Link href="/suspicious" className="inline-flex items-center gap-1 hover:text-foreground">
    <ArrowLeft className="size-3.5" /> Registry
  </Link>
);

export default async function NewSuspiciousPage({
  searchParams,
}: {
  searchParams: Promise<{ decoded?: string | string[] }>;
}) {
  const viewer = await getViewer();

  if (!isMember(viewer)) {
    // Keep a QR-checker seed through sign-in.
    const sp = await searchParams;
    const seed = Array.isArray(sp.decoded) ? sp.decoded[0] : sp.decoded;
    const next = seed ? `/suspicious/new?decoded=${encodeURIComponent(seed.slice(0, 2048))}` : "/suspicious/new";
    return (
      <>
        <Topbar title="Add report" subtitle="Members only" />
        <PageBody width="narrow">
          <PageHeader eyebrow={backLink} title="Report a suspicious taker" />
          <MembersTeaser
            icon={ShieldAlert}
            next={next}
            pending={!!viewer}
            title="Reporting is for verified merchants"
            description="Anyone can check the registry. To add a report, sign in with an approved merchant account, so every report has a real merchant behind it."
            points={[
              "Upload the taker's Binance profile QR, pick a reason, add evidence",
              "An admin reviews each report before it goes public",
              "Follow the status of everything you've reported",
            ]}
          />
        </PageBody>
      </>
    );
  }

  const admin = isAdmin(viewer);

  return (
    <>
      <Topbar title="Add report" subtitle="Flag a suspicious taker" />
      <PageBody width="narrow">
        <PageHeader
          eyebrow={backLink}
          title="Report a suspicious taker"
          description={
            admin
              ? "Upload the taker's Binance Share-Profile QR, pick a reason and add any evidence. As an admin, your report is published straight away."
              : "Upload the taker's Binance Share-Profile QR, pick a reason and add any evidence. An admin reviews it before it goes into the public registry."
          }
        />
        <ReportWorkspace isAdmin={admin} merchantName={viewer.merchantName} />
      </PageBody>
    </>
  );
}
