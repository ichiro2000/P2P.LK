"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { NAV_SECTIONS, type NavItem } from "./nav-config";
import { Badge } from "@/components/ui/badge";

export function Sidebar({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "hidden lg:flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
        "sticky top-0",
        className,
      )}
    >
      <div className="flex h-14 items-center px-5 border-b border-sidebar-border">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarLink key={item.href} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-md border border-sidebar-border bg-card/50 p-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="text-muted-foreground">Live · Binance P2P</span>
          </div>
          <div className="mt-1 text-[10px] leading-snug text-muted-foreground/70">
            Data refreshed every 20 seconds.
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active =
    item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);

  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
          active
            ? "bg-sidebar-accent text-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 w-0.5 rounded-r-full bg-primary"
          />
        )}
        <Icon
          className={cn(
            "h-4 w-4 transition-colors",
            active ? "text-primary" : "text-muted-foreground",
          )}
          strokeWidth={1.75}
        />
        <span className="flex-1">{item.label}</span>
        {item.soon && (
          <Badge
            variant="outline"
            className="h-4 border-dashed bg-transparent px-1.5 text-[9px] font-medium tracking-wide text-muted-foreground/80"
          >
            SOON
          </Badge>
        )}
      </Link>
    </li>
  );
}
