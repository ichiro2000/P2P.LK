"use client";

import { createContext, useContext, useOptimistic, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExchangeId } from "@/lib/exchanges";

type Ctx = {
  exchange: ExchangeId;
  /** True while the server re-renders for a newly picked exchange. */
  switching: boolean;
  setExchange: (ex: ExchangeId) => void;
};

const ExchangeContext = createContext<Ctx | null>(null);

/**
 * Holds the active exchange (seeded from the `ex` cookie by the server
 * layout). Switching writes the cookie and refreshes server components inside
 * a transition, so the current page stays on screen — no blank flash — until
 * the new exchange's data is ready.
 */
export function ExchangeProvider({ initial, children }: { initial: ExchangeId; children: ReactNode }) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  const [exchange, setOptimistic] = useOptimistic(initial);

  function setExchange(ex: ExchangeId) {
    if (ex === exchange) return;
    document.cookie = `ex=${ex}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      setOptimistic(ex);
      router.refresh();
    });
  }

  return (
    <ExchangeContext.Provider value={{ exchange, switching, setExchange }}>
      {children}
    </ExchangeContext.Provider>
  );
}

export function useExchange(): Ctx {
  const ctx = useContext(ExchangeContext);
  if (!ctx) throw new Error("useExchange must be used inside <ExchangeProvider>");
  return ctx;
}
