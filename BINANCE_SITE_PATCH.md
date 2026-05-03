# Patch for the Binance site (github.com/ichiro2000/P2P.LK)

Drop these three files / edits into the Binance repo to add the same
Binance/Bybit switcher tab. The component is identical — only `ACTIVE_EXCHANGE`
flips to `"binance"`.

## 1. New file: `lib/exchange.ts`

```ts
export type ExchangeId = "binance" | "bybit";

export const ACTIVE_EXCHANGE: ExchangeId = "binance";

export const OTHER_EXCHANGE_URL: string | undefined =
  process.env.NEXT_PUBLIC_OTHER_EXCHANGE_URL;

export const ACTIVE_EXCHANGE_LABEL: Record<ExchangeId, string> = {
  binance: "Binance",
  bybit: "Bybit",
};
```

## 2. New file: `components/shell/exchange-switch.tsx`

```tsx
import { cn } from "@/lib/utils";
import { ACTIVE_EXCHANGE, OTHER_EXCHANGE_URL } from "@/lib/exchange";

export function ExchangeSwitch({ className }: { className?: string }) {
  const otherUrl = OTHER_EXCHANGE_URL?.trim();
  if (!otherUrl) return null;

  const isBybit = ACTIVE_EXCHANGE === "bybit";
  return (
    <div
      className={cn(
        "hidden sm:inline-flex items-center rounded-md border border-border bg-card/50 p-0.5 text-[11px] font-medium",
        className,
      )}
      role="tablist"
      aria-label="Exchange"
    >
      <Tab label="Binance" active={!isBybit} href={isBybit ? otherUrl : null} />
      <Tab label="Bybit" active={isBybit} href={isBybit ? null : otherUrl} />
    </div>
  );
}

function Tab({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string | null;
}) {
  const className = cn(
    "inline-flex h-6 items-center rounded-[5px] px-2.5 leading-none transition-colors",
    active
      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
      : "text-muted-foreground hover:text-foreground",
  );

  if (active || !href) {
    return (
      <span
        className={className}
        role="tab"
        aria-selected={active}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </span>
    );
  }
  return (
    <a className={className} href={href} role="tab" aria-selected={false} rel="noopener">
      {label}
    </a>
  );
}
```

## 3. Edit: `components/shell/topbar.tsx`

Add the import:

```tsx
import { ExchangeSwitch } from "./exchange-switch";
```

Slot `<ExchangeSwitch />` into the right-side cluster, just before `{children}`:

```tsx
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
```

## 4. Edit: `.env.example` (and your live `.env.local`)

```bash
# Public URL of the *sister* deployment — the Bybit site for this Binance build.
# Leave empty and the switcher hides itself rather than shipping a dead link.
NEXT_PUBLIC_OTHER_EXCHANGE_URL=
```

In `.env.local`, set it to wherever you deploy the Bybit site, e.g.
`NEXT_PUBLIC_OTHER_EXCHANGE_URL=https://bybit.p2p.lk`.

## Result

| Site | `ACTIVE_EXCHANGE` | `NEXT_PUBLIC_OTHER_EXCHANGE_URL` | Tab behavior |
| --- | --- | --- | --- |
| Binance build | `"binance"` | the Bybit URL | Binance tab active, Bybit tab links out |
| Bybit build | `"bybit"`   | the Binance URL | Bybit tab active, Binance tab links out |

That's it. The cross-link is full-page navigation (no SPA prefetch), so each
deployment owns its own runtime/state. Update either env var without
redeploying code.
