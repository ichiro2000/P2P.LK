"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Clock, Download, LayoutDashboard, LogIn, LogOut, Monitor, Moon, Sun, UserCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "@/components/auth/sign-out-button";
import { runInstall, useInstall } from "@/components/pwa/install";
import { cn } from "@/lib/utils";
import { initialsOf, useViewer } from "./viewer-context";

/** Topbar account control: "Sign in" for guests, initials menu otherwise. */
export function UserMenu({ className }: { className?: string }) {
  const viewer = useViewer();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { signOut, pending } = useSignOut();
  const install = useInstall();

  if (!viewer) {
    return (
      <Button
        variant="outline"
        className={cn("h-8 gap-1.5 px-2.5 text-xs sm:text-sm", className)}
        render={<Link href="/sign-in" />}
        nativeButton={false}
      >
        <LogIn className="hidden size-4 sm:block" />
        Sign in
      </Button>
    );
  }

  const pendingStatus = !viewer.member;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("rounded-full", className)}
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-foreground font-mono text-[11px] font-semibold text-background">
              {initialsOf(viewer)}
            </span>
            <span className="sr-only">Account menu for {viewer.name || viewer.email}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-1.5 py-1.5">
            <div className="truncate text-sm font-medium text-foreground">{viewer.name || "Account"}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{viewer.email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {viewer.member ? (
            <DropdownMenuItem className="min-h-9" onClick={() => router.push("/app")}>
              <LayoutDashboard /> Dashboard
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="min-h-9" onClick={() => router.push("/account/status")}>
              <Clock /> Account status
              {pendingStatus && <span className="ml-auto text-[10px] text-muted-foreground">pending</span>}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-9" onClick={() => router.push("/account")}>
            <UserRound /> Account
          </DropdownMenuItem>
          {viewer.admin && (
            <DropdownMenuItem className="min-h-9" onClick={() => router.push("/admin/members")}>
              <UserCheck /> Members admin
            </DropdownMenuItem>
          )}
          {(install.canPrompt || install.iosManual) && (
            <DropdownMenuItem className="min-h-9" onClick={() => void runInstall(install)}>
              <Download /> {install.iosManual ? "Add to Home Screen" : "Install app"}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
            <DropdownMenuRadioItem value="light" className="min-h-9">
              <Sun /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className="min-h-9">
              <Moon /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" className="min-h-9">
              <Monitor /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-9" onClick={signOut} disabled={pending}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
