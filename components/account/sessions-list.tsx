"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth/client";
import { disablePush } from "@/lib/push/client";
import { formatSLT } from "@/lib/format";
import type { DeviceSession } from "@/lib/account";
import { revokeDeviceSession } from "@/app/(app)/account/actions";

/** Signed-in devices. Server-rendered list; actions refresh it. */
export function SessionsList({ sessions }: { sessions: DeviceSession[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const others = sessions.filter((s) => !s.current).length;

  async function revoke(id: string) {
    setBusy(id);
    const res = await revokeDeviceSession(id);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Device signed out");
    start(() => router.refresh());
  }

  async function revokeOthers() {
    setBusy("others");
    const { error } = await authClient.revokeOtherSessions();
    setBusy(null);
    if (error) {
      toast.error(error.message || "Couldn't sign the other devices out. Try again.");
      return;
    }
    toast.success("Signed out everywhere else");
    start(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <Card className="gap-0 py-0">
        <ul className="divide-y divide-border">
          {sessions.map((s) => {
            const Icon = s.mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.device}</span>
                      {s.current && (
                        <Badge variant="outline" className="gap-1.5">
                          <span className="size-1.5 rounded-full bg-[color:var(--color-buy)]" aria-hidden />
                          This device
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs break-words text-muted-foreground">
                      {s.ip ? <span className="font-mono">{s.ip}</span> : "IP unknown"}
                      {" · "}signed in {formatSLT(new Date(s.createdAt))}
                    </div>
                    <div className="text-xs text-muted-foreground">Last active {formatSLT(new Date(s.updatedAt))}</div>
                  </div>
                </div>
                {!s.current && (
                  <Button
                    variant="outline"
                    className="h-10 w-full shrink-0 px-3 sm:h-8 sm:w-auto"
                    disabled={busy !== null}
                    onClick={() => revoke(s.id)}
                    aria-label={`Sign out ${s.device}`}
                  >
                    {busy === s.id ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {others > 0 ? (
        <Button variant="outline" className="h-10 px-3" disabled={busy !== null} onClick={revokeOthers}>
          {busy === "others" && <Loader2 className="animate-spin" aria-hidden />}
          Sign out everywhere else ({others})
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">You&apos;re only signed in on this device.</p>
      )}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      className="h-10 px-4"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // Explicit sign-out stops push alerts on this device (see useSignOut).
        await disablePush();
        const { error } = await authClient.signOut();
        if (error) {
          setPending(false);
          toast.error("Couldn't sign out. Try again.");
          return;
        }
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      Sign out
    </Button>
  );
}
