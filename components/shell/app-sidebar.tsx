"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { EXCHANGES } from "@/lib/exchanges";
import { InstallHint } from "@/components/pwa/install";
import { Brand } from "./brand";
import { useExchange } from "./exchange-context";
import { isActivePath, navSectionsFor } from "./nav-config";
import { useViewer } from "./viewer-context";

/** Desktop: collapsible to an icon rail (⌘B). Mobile: slide-in sheet,
 *  opened from the topbar trigger or the bottom bar's "More" tab. Members see
 *  "My P2P.LK", admins also "Admin"; guests get a sign-up card in the footer. */
export function AppSidebar() {
  const pathname = usePathname();
  const { exchange } = useExchange();
  const { isMobile, setOpenMobile } = useSidebar();
  const viewer = useViewer();
  const sections = navSectionsFor(viewer);
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" onClick={close} />} tooltip="P2P.LK">
              <Brand className="-ml-0.5 group-data-[collapsible=icon]:ml-0" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActivePath(pathname, item.href)}
                      tooltip={item.label}
                      render={<Link href={item.href} onClick={close} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.soon && <SidebarMenuBadge>soon</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {!viewer && (
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-1.5 text-sm font-medium text-sidebar-foreground">
              <Sparkles className="size-3.5" aria-hidden />
              Create a free account
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Dashboard, price alerts by email, watchlists and CSV reports for LK merchants.
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <Button className="h-8 flex-1 text-xs" render={<Link href="/sign-up" onClick={close} />} nativeButton={false}>
                Sign up
              </Button>
              <Button
                variant="outline"
                className="h-8 flex-1 text-xs"
                render={<Link href="/sign-in" onClick={close} />}
                nativeButton={false}
              >
                Sign in
              </Button>
            </div>
          </div>
        )}
        {viewer && !viewer.member && (
          <Link
            href="/account/status"
            onClick={close}
            className="flex items-start gap-2 rounded-lg border border-sidebar-border p-3 text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <span className="block font-medium text-sidebar-foreground">
                {viewer.status === "pending_review" ? "Account under review" : "Account status"}
              </span>
              <span className="text-muted-foreground">See what happens next</span>
            </span>
          </Link>
        )}
        <InstallHint onAction={close} />
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="relative flex size-2 shrink-0">
            <span className="live-dot absolute inline-flex size-full rounded-full bg-[color:var(--color-buy)] opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-[color:var(--color-buy)]" />
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">
            Live · {EXCHANGES[exchange].label} P2P
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
