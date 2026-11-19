"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTION, isActivePath } from "@/components/shell/nav-config";
import { cn } from "@/lib/utils";

/**
 * Compact admin sub-nav under the page's top bar. One row of pills that
 * scrolls sideways on phones (the page itself never scrolls sideways).
 * Links come from ADMIN_SECTION, so the sidebar and this bar never drift.
 */
function scrollIntoRow(el: HTMLAnchorElement | null) {
  const row = el?.closest("ul");
  const item = el?.parentElement;
  if (!row || !item) return;
  if (item.offsetLeft + item.offsetWidth > row.clientWidth + row.scrollLeft || item.offsetLeft < row.scrollLeft) {
    row.scrollLeft = item.offsetLeft - 12;
  }
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin sections"
      data-slot="admin-nav"
      className="border-b border-border bg-background"
    >
      <ul className="flex min-w-0 snap-x items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
        {ADMIN_SECTION.items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0 snap-start">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                // Phones: bring the active pill into view in the scroller.
                ref={active ? scrollIntoRow : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
