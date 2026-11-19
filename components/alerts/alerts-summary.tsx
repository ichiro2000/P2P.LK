"use client";

import { useMemo, useState } from "react";
import { KpiGrid } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { useAlertEvents, useAlertRules, type MemberEvent } from "@/hooks/use-member-data";

const DAY = 86_400;

/** Events per day for the last 7 days, oldest first. */
function perDay(events: MemberEvent[], nowSec: number) {
  const counts = new Array<number>(7).fill(0);
  for (const e of events) {
    const age = Math.floor((nowSec - e.ts) / DAY);
    if (age >= 0 && age < 7) counts[6 - age] += 1;
  }
  return counts;
}

/** Headline numbers for the alerts page, from the member's account. */
export function AlertsSummary() {
  const { rules } = useAlertRules();
  const { events, unread } = useAlertEvents();
  // Fixed at mount; the page is short-lived and this keeps render pure.
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const stats = useMemo(() => {
    const days = perDay(events, nowSec);
    return { days, week: days.reduce((s, n) => s + n, 0), emailed: events.filter((e) => e.emailed).length };
  }, [events, nowSec]);
  const enabled = rules.filter((r) => r.enabled).length;
  const emailRules = rules.filter((r) => r.enabled && r.email).length;

  return (
    <KpiGrid>
      <KpiCard label="Rules" value={rules.length} sub={`${enabled} on · ${emailRules} by email`} />
      <KpiCard label="Events · 7 days" value={stats.week} spark={stats.days} sparkTone="neutral" />
      <KpiCard label="Unread" value={unread} sub={unread > 0 ? "tap an event to mark it read" : "all caught up"} />
      <KpiCard label="Emailed" value={stats.emailed} sub={`of ${events.length} stored`} />
    </KpiGrid>
  );
}
