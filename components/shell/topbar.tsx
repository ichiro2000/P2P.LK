"use client";

import { Activity } from "lucide-react";
import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { ExchangeSwitch } from "./exchange-switch";
import { LiveClock } from "@/components/common/live-clock";

export function Topbar({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-full items-center gap-3 px-4 sm:px-6">
        <MobileNav />
        <div className="flex items-center gap-2 lg:hidden">
          <Brand compact />
        </div>

        <div className="hidden lg:flex flex-col justify-center min-w-0">
          {title && (
            <div className="text-[13px] font-medium leading-none text-foreground truncate">
              {title}
            </div>
          )}
          {subtitle && (
            <div className="mt-1 text-[11px] leading-none text-muted-foreground truncate">
              {subtitle}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ExchangeSwitch />
          {children}
          <div className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <Activity className="h-3 w-3 text-primary" strokeWidth={2} />
            <span className="font-mono tabular-nums">
              <LiveClock />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
