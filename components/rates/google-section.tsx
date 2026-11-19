import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/common/kpi-card";
import { PageSection } from "@/components/common/page";
import { EXCHANGES } from "@/lib/exchanges";
import { formatPct } from "@/lib/format";
import { GOOGLE_SOURCE } from "@/lib/fx/google";
import { googleSeries, latestGoogle, p2pVsGoogle, type P2PVsGoogle } from "@/lib/fx/google-view";
import { cn } from "@/lib/utils";
import { GoogleChart } from "./google-chart";

const pct = (v: number | null) => (v == null ? "—" : formatPct(v, { frac: 2, sign: true }));
const rs = (v: number | null) => (v == null ? "—" : `Rs ${v.toFixed(2)}`);
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Google's USD → LKR (mid-market) and how the USDT P2P price sits against it.
 * The decision cue is the premium *relative to its own 7-day average*: the
 * premium itself is always positive (USDT carries a P2P cost), what matters
 * is whether it's unusually wide (USDT dear) or narrow (USDT cheap) today.
 */
export async function GoogleSection() {
  const google = await latestGoogle();
  const [quotes, day, week] = await Promise.all([
    p2pVsGoogle(google?.value ?? null),
    googleSeries("24h"),
    googleSeries("7d"),
  ]);
  // The "usual gap" needs real history behind it: 7d points are hourly, so
  // require ≥ 12 hours with a premium before comparing against it.
  const MIN_HOURS = 12;
  const base = (k: "binancePremium" | "bybitPremium") => {
    const v = week.map((p) => p[k]);
    const hours = v.filter((x) => x != null).length;
    return { avg: hours >= MIN_HOURS ? avg(v) : null, hours };
  };
  const weekAvg = { binance: base("binancePremium"), bybit: base("bybitPremium") };
  const stale = google != null && google.ageMin > 75;

  return (
    <PageSection
      id="google"
      title="Google USD/LKR vs USDT"
      description="Google's mid-market dollar (checked every 30 minutes) is what the USDT/LKR P2P price tracks most closely. The premium is how far USDT trades above it."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Google USD/LKR"
          value={google ? google.value.toFixed(2) : "—"}
          change={google?.change ?? null}
          changeLabel="vs prev. close"
          sub={
            google
              ? stale
                ? `stale · ${google.ageMin} min old`
                : `${google.ageMin} min ago`
              : "first reading pending"
          }
          spark={day.map((p) => p.google)}
          sparkTone="neutral"
          className={cn(stale && "ring-1 ring-[color:var(--color-warn)]")}
        />
        {quotes.map((q) => (
          <ExchangeCard key={q.exchange} q={q} weekAvg={weekAvg[q.exchange]} />
        ))}
      </div>
      <GoogleChart initial={{ range: "24h", points: day }} />
      <p className="text-[11px] text-muted-foreground">
        Source:{" "}
        <a href={GOOGLE_SOURCE.pageUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {GOOGLE_SOURCE.name}
        </a>
        . Mid-market rate, indicative only — banks and remittance services charge a margin on top. Premium = P2P price ÷
        Google USD/LKR − 1, using verified-merchant ads.
      </p>
    </PageSection>
  );
}

function ExchangeCard({ q, weekAvg: w }: { q: P2PVsGoogle; weekAvg: { avg: number | null; hours: number } }) {
  const label = EXCHANGES[q.exchange].label;
  const weekAvg = w.avg;
  const vsNormal = q.midPremium != null && weekAvg != null ? q.midPremium - weekAvg : null;
  // ±0.15 percentage points of the weekly average counts as "normal".
  const verdict =
    vsNormal == null ? null : vsNormal > 0.0015 ? "dear" : vsNormal < -0.0015 ? "cheap" : "normal";
  return (
    <Card className="gap-3 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label} USDT vs Google</span>
        {verdict && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              verdict === "dear" && "bg-[color:var(--color-sell)]/12 text-[color:var(--color-sell)]",
              verdict === "cheap" && "bg-[color:var(--color-buy)]/12 text-[color:var(--color-buy)]",
              verdict === "normal" && "bg-muted text-muted-foreground",
            )}
          >
            {verdict === "dear" ? "USDT dear vs usual" : verdict === "cheap" ? "USDT cheap vs usual" : "Usual gap"}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-[11px] text-muted-foreground">Buy USDT at</dt>
        <dt className="text-[11px] text-muted-foreground">Sell USDT at</dt>
        <dd className="font-mono text-base font-semibold tabular-nums text-[color:var(--color-buy)]">{rs(q.buy)}</dd>
        <dd className="font-mono text-base font-semibold tabular-nums text-[color:var(--color-sell)]">{rs(q.sell)}</dd>
        <dd className="font-mono text-xs tabular-nums text-muted-foreground">{pct(q.buyPremium)} vs Google</dd>
        <dd className="font-mono text-xs tabular-nums text-muted-foreground">{pct(q.sellPremium)} vs Google</dd>
      </dl>
      <p className="text-[11px] text-muted-foreground">
        Mid premium {pct(q.midPremium)}
        {weekAvg != null ? (
          <>
            {" "}
            · {w.hours >= 7 * 24 - 6 ? "7-day" : `${Math.round(w.hours / 24) || 1}-day`} avg {pct(weekAvg)}
            {vsNormal != null && ` (${vsNormal >= 0 ? "+" : ""}${(vsNormal * 100).toFixed(2)} pts)`}
          </>
        ) : (
          <> · usual-gap check starts after 12 h of readings ({w.hours} h so far)</>
        )}
      </p>
    </Card>
  );
}
