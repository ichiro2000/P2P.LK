import { BellRing } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader, PageSection } from "@/components/common/page";
import { LiveDot } from "@/components/common/live-dot";
import { Badge } from "@/components/ui/badge";
import { RuleForm } from "@/components/alerts/rule-form";
import { RulesList } from "@/components/alerts/rules-list";
import { EventLog, EventLogActions } from "@/components/alerts/event-log";
import { AlertsSummary } from "@/components/alerts/alerts-summary";
import { NotificationsCard } from "@/components/pwa/notifications-card";
import { MembersTeaser } from "@/components/members/members-teaser";
import { MemberHint } from "@/components/members/member-hint";
import { getViewer, isMember } from "@/lib/auth/session";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Alerts", "follow");
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const viewer = await getViewer();

  if (!isMember(viewer)) {
    return (
      <>
        <Topbar title="Alerts" subtitle="Members only" />
        <PageBody>
          <MembersTeaser
            icon={BellRing}
            next="/alerts"
            pending={!!viewer}
            title="Get alerts when the market crosses your line"
            description="Create a free account to get alerts by email, even when this tab is closed."
            points={[
              "Price, spread and depth alerts for Binance and Bybit",
              "Taker signals: an ad priced well below the top-5 average",
              "Checked by our servers every minute, with email and in-app inbox",
            ]}
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <Topbar title="Alerts" subtitle="Rules and recent events" />
      <MemberHint userId={viewer.id} />
      <PageBody>
        <PageHeader
          title="Get notified when the market crosses a line"
          description="Your rules are checked on our servers every minute, even when this tab is closed. Matches land in the inbox below and, if you switch it on, in your email. A cooldown stops one rule from firing over and over."
          actions={
            <>
              <Badge variant="outline">Synced to your account</Badge>
              <LiveDot label="Server checks" />
            </>
          }
        />

        <AlertsSummary />

        <PageSection
          id="notifications"
          title="Phone and desktop notifications"
          description="Get each alert as a notification, even when P2P.LK is closed. Turn it on separately on every device."
        >
          <NotificationsCard />
        </PageSection>

        <PageSection title="New rule">
          <RuleForm />
        </PageSection>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <PageSection title="Rules">
            <RulesList />
          </PageSection>
          <PageSection title="Inbox" actions={<EventLogActions />}>
            <EventLog />
          </PageSection>
        </div>
      </PageBody>
    </>
  );
}
