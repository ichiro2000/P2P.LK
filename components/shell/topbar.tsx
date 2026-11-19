"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { CommandMenuTrigger } from "./command-menu";
import { ExchangeSwitch } from "./exchange-switch";
import { UserMenu } from "./user-menu";
import { useViewer } from "./viewer-context";

/**
 * Sticky page header: sidebar toggle, page title, global search (⌘K),
 * exchange switch, theme and the account menu (theme moves into the account
 * menu on phones once signed in, to save room). Page-specific actions go in `children` and
 * drop to a second row on phones so nothing gets squeezed.
 */
export function Topbar({
  title,
  subtitle,
  children,
  titleAs = "h1",
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** The page's one <h1>. Loading skeletons pass "p": their markup sits in
   *  the streamed HTML next to the real page, and a second "Loading" h1 is
   *  what non-rendering crawlers would read. */
  titleAs?: "h1" | "p";
}) {
  const viewer = useViewer();
  const Title = titleAs;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
        <Separator orientation="vertical" className="mr-1 hidden h-4 md:block" />
        <div className="min-w-0 flex-1">
          {title && <Title className="truncate text-sm font-semibold leading-tight text-foreground">{title}</Title>}
          {subtitle && <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <CommandMenuTrigger />
          {children && <div className="hidden items-center gap-1.5 lg:flex">{children}</div>}
          <ExchangeSwitch />
          <div className={viewer ? "hidden sm:flex" : "flex"}>
            <ThemeToggle />
          </div>
          <UserMenu />
        </div>
      </div>
      {children && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
          {children}
        </div>
      )}
    </header>
  );
}
