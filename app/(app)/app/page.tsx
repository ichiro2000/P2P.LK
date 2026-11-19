import Link from "next/link";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader, PageSection } from "@/components/common/page";
import { CommunityCard } from "@/components/common/community-card";
import { Badge } from "@/components/ui/badge";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { MarketTiles, StarNudge } from "@/components/dashboard/market-tiles";
import { OwnMerchantCard } from "@/components/dashboard/own-merchant-card";
import { FavouriteMerchants, QuickLinks, RecentAlerts, SavedFilters } from "@/components/dashboard/lists";
import { requireMember } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import { formatSLT } from "@/lib/format";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Dashboard");
export const dynamic = "force-dynamic";

function greeting(): string {
  const h = Math.floor(((Math.floor(Date.now() / 1000) + SLT_OFFSET_SEC) % 86400) / 3600);
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const LINK = "inline-flex h-10 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:h-8";

export default async function DashboardPage() {
  const viewer = await requireMember("/app");
  const data = await loadDashboard(viewer);
  const first = viewer.name.trim().split(/\s+/)[0] || "there";
  const hasAnyLink = Boolean(viewer.binanceUrl || viewer.bybitUrl);

  return (
    <>
      <Topbar title="Dashboard" subtitle={viewer.merchantName || "Your P2P.LK home"}>
        <RefreshButton />
      </Topbar>

      <PageBody>
        <PageHeader
          eyebrow={formatSLT(new Date(), { dateStyle: "full", timeStyle: undefined })}
          title={`${greeting()}, ${first}`}
          description="Your markets, your merchant profile, alerts and saved views in one place. Prices are from the latest minute's book."
          actions={
            <Badge variant="outline" className="gap-1.5">
              <span className="size-1.5 rounded-full bg-[color:var(--color-buy)]" aria-hidden />
              {viewer.role === "admin" ? "Admin" : "Approved member"}
            </Badge>
          }
        />

        <PageSection
          title="Your markets"
          description={data.defaultMarkets ? "Default view" : "Markets you starred, on both exchanges"}
        >
          {data.defaultMarkets && <StarNudge />}
          <MarketTiles tiles={data.markets} />
        </PageSection>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
          <div className="min-w-0 space-y-6 lg:col-span-3 lg:space-y-8">
            <PageSection
              title="Your merchant"
              description="Matched from the profile links on your account"
              actions={
                <Link href="/account#profile" className={LINK}>
                  Edit links
                </Link>
              }
            >
              <OwnMerchantCard own={data.own} hasAnyLink={hasAnyLink} />
            </PageSection>

            <PageSection
              title={
                <span className="inline-flex items-center gap-2">
                  Recent alerts
                  {data.unread > 0 && (
                    <Badge className="h-5 bg-[color:var(--color-warn)]/15 font-mono text-[color:var(--color-warn)]">
                      {data.unread} unread
                    </Badge>
                  )}
                </span>
              }
              actions={
                <Link href="/alerts" className={LINK}>
                  All alerts
                </Link>
              }
            >
              <RecentAlerts events={data.events} />
            </PageSection>
          </div>

          <div className="min-w-0 space-y-6 lg:col-span-2 lg:space-y-8">
            <PageSection
              title="Favourite merchants"
              description="Live = listing in the latest sweep"
              actions={
                data.favourites.total > data.favourites.items.length ? (
                  <Link href="/workspace" className={LINK}>
                    All {data.favourites.total}
                  </Link>
                ) : undefined
              }
            >
              <FavouriteMerchants items={data.favourites.items} />
            </PageSection>

            <PageSection
              title="Saved filters"
              actions={
                data.filters.total > data.filters.items.length ? (
                  <Link href="/workspace" className={LINK}>
                    All {data.filters.total}
                  </Link>
                ) : undefined
              }
            >
              <SavedFilters items={data.filters.items} />
            </PageSection>

            <PageSection title="Quick links">
              <QuickLinks />
            </PageSection>
          </div>
        </div>
        <CommunityCard />
      </PageBody>
    </>
  );
}
