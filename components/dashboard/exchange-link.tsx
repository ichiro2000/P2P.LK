"use client";

import Link from "next/link";
import { useExchange } from "@/components/shell/exchange-context";
import type { ExchangeId } from "@/lib/exchanges/types";

/**
 * Link to a page that reads the active exchange from the `ex` cookie (the
 * merchant detail page, the live market). Same exchange → normal client
 * navigation. Other exchange → write the cookie and do a full page load, so
 * the server render and the top-bar switch both pick up the new exchange.
 */
export function ExchangeLink({
  exchange,
  href,
  className,
  children,
  ...rest
}: {
  exchange: ExchangeId;
  href: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"a">, "href" | "className" | "children">) {
  const { exchange: active } = useExchange();
  if (exchange === active) {
    return (
      <Link href={href} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        document.cookie = `ex=${exchange}; path=/; max-age=31536000; samesite=lax`;
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
