"use client";

import { useState } from "react";
import { AddReportForm } from "./add-report-form";
import { MyReports } from "./my-reports";

/** Add-report form plus the member's own submissions; a successful member
 *  submission refreshes the list. */
export function ReportWorkspace({ isAdmin, merchantName }: { isAdmin: boolean; merchantName: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-8">
      <AddReportForm isAdmin={isAdmin} merchantName={merchantName} onSubmitted={() => setRefreshKey((k) => k + 1)} />
      <MyReports refreshKey={refreshKey} />
    </div>
  );
}
