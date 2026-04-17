import Link from "next/link";
import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { Reveal } from "@/components/common/reveal";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { QrChecker } from "@/components/suspicious/qr-checker";
import { RegistryList } from "@/components/suspicious/registry-list";
import { listSuspicious } from "@/lib/db/suspicious";

export const metadata = { title: "Suspicious Takers" };
export const dynamic = "force-dynamic";

export default async function SuspiciousPage() {
  const reports = await listSuspicious();

  return (
    <>
      <Topbar title="Suspicious Takers" subtitle="Community-maintained registry">
        <Link
          href="/suspicious/new"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <Plus className="h-4 w-4" /> Add report
        </Link>
      </Topbar>

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Community registry"
          title="Is this taker safe to trade with?"
          description="Upload a Binance Share-Profile QR to check it against reports from other merchants. Decoding happens locally in your browser — the image never leaves your device."
        />

        <Reveal>
          <QrChecker />
        </Reveal>

        <Reveal delay={70}>
          <RegistryList reports={reports} />
        </Reveal>
      </div>
    </>
  );
}
