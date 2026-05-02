"use client";

import { useEffect } from "react";
import { Topbar } from "@/components/shell/topbar";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[app error]", error);
  }, [error]);

  return (
    <>
      <Topbar title="Something broke" subtitle="Unexpected error" />
      <div className="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--color-sell)]/30 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The public Bybit P2P feed can reject our requests when under load.
          Try again in a few seconds.
        </p>
        {error?.digest && (
          <code className="mt-4 inline-flex rounded-md border border-border bg-card/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {error.digest}
          </code>
        )}
        <Button onClick={reset} className="mt-6 gap-2" variant="default">
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          Try again
        </Button>
      </div>
    </>
  );
}
