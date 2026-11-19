"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { disablePush } from "@/lib/push/client";
import { cn } from "@/lib/utils";

/** Signs out, then lands on the live markets with fresh server data. */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    try {
      // Explicit sign-out stops alerts on THIS device (needs the session, so
      // it runs first). Session expiry never does: push belongs to the user.
      await disablePush();
      await authClient.signOut();
    } finally {
      router.push("/");
      router.refresh();
      setPending(false);
    }
  }
  return { signOut, pending };
}

export function SignOutButton({ className }: { className?: string }) {
  const { signOut, pending } = useSignOut();
  return (
    <Button type="button" variant="outline" className={cn("h-10", className)} onClick={signOut} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
      Sign out
    </Button>
  );
}
