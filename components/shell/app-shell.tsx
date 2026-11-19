import { Suspense } from "react";
import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { RecentTracker } from "@/components/workspace/recent-tracker";
import { AlertChecker } from "@/components/alerts/alert-checker";
import { PushSync } from "@/components/pwa/push-sync";
import { getViewer, isAdmin, isMember } from "@/lib/auth/session";
import { getFlags } from "@/lib/flags";
import { AppSidebar } from "./app-sidebar";
import { CommandMenuProvider } from "./command-menu";
import { MobileTabBar } from "./mobile-tab-bar";
import { SiteBanner } from "./site-banner";
import { ViewerProvider, type ShellViewer } from "./viewer-context";

/** Sidebar + content frame shared by every page (and the 404). The sidebar's
 *  collapsed state is read from its cookie so the first paint is correct, and
 *  the viewer is resolved here so the account menu never flashes. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const [jar, v, flags] = await Promise.all([cookies(), getViewer(), getFlags()]);
  const defaultOpen = jar.get("sidebar_state")?.value !== "false";
  const viewer: ShellViewer | null = v
    ? {
        name: v.name,
        email: v.email,
        role: v.role,
        status: v.status,
        member: isMember(v),
        admin: isAdmin(v),
      }
    : null;
  return (
    <ViewerProvider viewer={viewer}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <CommandMenuProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0 pb-safe-nav md:pb-0">
            {flags.banner && <SiteBanner text={flags.banner} />}
            {children}
          </SidebarInset>
          <MobileTabBar />
          <Suspense fallback={null}>
            <RecentTracker />
          </Suspense>
          <AlertChecker />
          {viewer?.member && <PushSync />}
        </CommandMenuProvider>
      </SidebarProvider>
    </ViewerProvider>
  );
}
