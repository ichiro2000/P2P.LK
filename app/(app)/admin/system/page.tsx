import Link from "next/link";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader, PageSection } from "@/components/common/page";
import { requireAdminPage } from "@/lib/auth/session";
import { FX_SOURCE_META } from "@/lib/fx/sources";
import { RefreshButton } from "@/components/admin/overview/refresh-button";
import { JOB_LABEL, exLabel } from "@/components/admin/overview/format";
import { RUN_EXCHANGES, RUN_JOBS, RUN_LIMIT, loadSystem, parseRunFilter } from "@/components/admin/system/data";
import { RunsFilter } from "@/components/admin/system/runs-filter";
import { FxSources, RetentionSummary, RunsList } from "@/components/admin/system/sections";
import { FlagsPanel } from "@/components/admin/system/flags-panel";
import { ActionsPanel } from "@/components/admin/system/actions-panel";
import { PushHealth } from "@/components/admin/system/push-health";
import { loadPushHealth } from "@/lib/push/health";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Admin · System");
export const dynamic = "force-dynamic";

const JOB_OPTS = RUN_JOBS.map((j) => ({ value: j, label: JOB_LABEL[j] ?? j }));
const EX_OPTS = RUN_EXCHANGES.map((e) => ({
  value: e,
  label: e === "none" ? "No exchange" : (FX_SOURCE_META[e]?.shortName ?? exLabel(e)),
}));

export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage("/admin/system");
  const filter = parseRunFilter(await searchParams);
  const [{ now, runs, fx, flags }, push] = await Promise.all([
    loadSystem(filter),
    // Never let push stats take the page down (e.g. code deployed before migration 0007).
    loadPushHealth().catch((err: Error) => {
      console.error("[admin/system] push health failed", err);
      return null;
    }),
  ]);

  return (
    <>
      <Topbar title="System" subtitle="Admin · ingest, flags, maintenance" />
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="System"
          description="Feature flags, maintenance actions, ingest runs, FX sources and the retention policy."
          actions={<RefreshButton />}
        />

        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <PageSection id="flags" title="Feature flags" description="Stored in KV (flags:v1).">
            <FlagsPanel initial={flags} />
          </PageSection>
          <PageSection
            id="actions"
            title="Manual actions"
            description="Run now, on this request. Each one is locked for a short while against double runs."
          >
            <ActionsPanel />
          </PageSection>
        </div>

        <PageSection
          id="push"
          title="Push notifications"
          description="Web Push to members' devices. Sends are logged as ingest runs (job “push”). Devices are removed only when the push service answers 404/410."
        >
          {push ? (
            <PushHealth health={push} />
          ) : (
            <p className="text-sm text-[color:var(--color-sell)]">
              Couldn&apos;t read push health. Is migration 0007_push_subscriptions applied?
            </p>
          )}
        </PageSection>

        <PageSection
          id="runs"
          title="Ingest runs"
          description={`Newest first · up to ${RUN_LIMIT} runs · kept 7 days`}
        >
          <RunsFilter
            job={filter.job}
            exchange={filter.exchange}
            failed={filter.failed}
            jobs={JOB_OPTS}
            exchanges={EX_OPTS}
          />
          <RunsList runs={runs} />
        </PageSection>

        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <PageSection
            id="fx"
            title="FX sources"
            description="From fx_rates and the latest fx run per source."
            actions={
              <Link
                href="/rates#sources"
                className="inline-flex min-h-8 items-center text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Sources and terms
              </Link>
            }
          >
            <FxSources sources={fx} now={now} />
            <p className="text-[11px] text-muted-foreground">
              Per-source terms review: <span className="font-mono">lib/fx/SOURCES.md</span> in the repo.
            </p>
          </PageSection>
          <PageSection id="retention" title="Retention policy" description="Read-only. Set in lib/ingest/jobs.ts.">
            <RetentionSummary />
          </PageSection>
        </div>
      </PageBody>
    </>
  );
}
