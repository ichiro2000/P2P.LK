import { Sidebar } from "@/components/shell/sidebar";
import { RecentTracker } from "@/components/workspace/recent-tracker";
import { AlertChecker } from "@/components/alerts/alert-checker";
import { Suspense } from "react";

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1">{children}</main>
      </div>
      <Suspense fallback={null}>
        <RecentTracker />
      </Suspense>
      <AlertChecker />
    </div>
  );
}
