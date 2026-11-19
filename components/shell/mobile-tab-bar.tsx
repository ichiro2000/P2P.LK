"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS, MEMBER_MOBILE_TABS, MOBILE_TABS, isActivePath } from "./nav-config";
import { useViewer } from "./viewer-context";

const toItems = (hrefs: readonly string[]) => hrefs.map((href) => ALL_NAV_ITEMS.find((i) => i.href === href)!);
const GUEST_TABS = toItems(MOBILE_TABS);
const MEMBER_TABS = toItems(MEMBER_MOBILE_TABS);

/** Thumb-reach navigation on phones: four primary pages + "More" (opens the
 *  full sidebar sheet). Members get their dashboard in place of Scams. Hidden from md up, where the sidebar is visible. */
export function MobileTabBar() {
  const pathname = usePathname();
  const { openMobile, setOpenMobile } = useSidebar();
  const TABS = useViewer()?.member ? MEMBER_TABS : GUEST_TABS;
  const onTab = TABS.some((t) => isActivePath(pathname, t.href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors active:bg-muted",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                {item.short ?? item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(!openMobile)}
            aria-expanded={openMobile}
            className={cn(
              "flex h-14 w-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors active:bg-muted",
              openMobile || !onTab ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Menu className="size-5" strokeWidth={openMobile || !onTab ? 2.25 : 1.75} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
