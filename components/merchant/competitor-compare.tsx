"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, RefreshCw, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoPopover } from "@/components/common/info-popover";
import { Field } from "@/components/compare/book-controls";
import { Segmented } from "@/components/market/segmented";
import { TierBadge } from "@/components/merchant/tier-badge";
import { OwnSpreadText } from "@/components/merchant/own-spread";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import {
  MIN_BANDS,
  MIN_PRESETS,
  bookBestPrices,
  compareCompetitors,
  selfAd,
  type CompetitorInfo,
  type CompetitorRow,
  type MinBand,
} from "@/lib/competitors";
import { PRICE_TICK } from "@/lib/placement";
import { orderCapFiat } from "@/lib/liquidity";
import { num } from "@/lib/arbitrage";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct, formatSLT, formatSigned, formatCount } from "@/lib/format";
import type { ExchangeId, PayTypeOption } from "@/lib/exchanges/types";
import type { NormalizedAd, TradeType } from "@/lib/types";
import { cn } from "@/lib/utils";

const S = FIAT.symbol;
const VISIBLE = 15;
const NONE = "__any";

const bandLabel = (b: MinBand) => (b == null ? "Any" : `±${Math.round(b * 100)}%`);

/**
 * "Compare with competitors": live ads on the same side whose minimum order
 * is close to yours (or a custom minimum), ranked best-for-the-taker first,
 * with your own ad as a highlighted "You" row and the price that takes #1.
 *
 * Merchant-picking mode (`pickable`) is for /merchants: the visitor chooses
 * whose ads to compare (defaults to their linked merchant).
 */
export function CompetitorCompare({
  exchange,
  ads,
  bookTs,
  info,
  selfId = null,
  selfName = null,
  pickable = false,
  payTypes,
  onRefresh,
  refreshing,
  scopeNote,
}: {
  exchange: ExchangeId;
  /** Live book, both sides. */
  ads: readonly NormalizedAd[];
  /** Unix seconds the book was captured. */
  bookTs: number | null;
  info: Record<string, CompetitorInfo>;
  /** The merchant comparing (detail page's merchant or the member's own). */
  selfId?: string | null;
  selfName?: string | null;
  /** Let the visitor pick the merchant from the book. */
  pickable?: boolean;
  payTypes: readonly PayTypeOption[];
  /** Refresh from the page's poller; without it the server render is refreshed. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Extra note on what the book covers. */
  scopeNote?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(selfId);
  const [side, setSide] = useState<TradeType>("SELL");
  const [mode, setMode] = useState<"mine" | "custom">(selfId ? "mine" : "custom");
  const [customStr, setCustomStr] = useState("50000");
  const [band, setBand] = useState<MinBand>(0.25);
  const [maxStr, setMaxStr] = useState("");
  const [payType, setPayType] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const me = pickable ? picked : selfId;
  const merchants = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of ads) if (!m.has(a.merchant.id)) m.set(a.merchant.id, a.merchant.name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [ads]);
  const meName = (me && merchants.find((m) => m.id === me)?.name) || (me === selfId ? selfName : null) || null;

  const mine = selfAd(ads, side, me);
  const usingMine = mode === "mine" && me != null && mine != null;
  const custom = num(customStr);
  const refMin = usingMine ? Math.max(0, mine.minOrder) : custom;
  const maxOrder = num(maxStr);
  const badMax = maxOrder > 0 && maxOrder < refMin;
  const tick = PRICE_TICK[exchange];

  const result = useMemo(
    () =>
      compareCompetitors(
        ads,
        { side, refMin, band, maxOrder: badMax ? null : maxOrder, payType, onlineOnly, selfId: me },
        tick,
      ),
    [ads, side, refMin, band, maxOrder, badMax, payType, onlineOnly, me, tick],
  );
  const bookPrices = useMemo(() => bookBestPrices(ads), [ads]);

  const selling = side === "SELL";
  const priceTone = selling ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]";
  const sideWord = selling ? "Sell" : "Buy";

  // Keep the "You" row visible even when it ranks below the fold.
  const rows = showAll ? result.rows : result.rows.slice(0, VISIBLE);
  const selfHidden = !showAll && result.rows.findIndex((r) => r.isSelf) >= VISIBLE;
  const shown = selfHidden ? [...rows, result.rows.find((r) => r.isSelf)!] : rows;

  const spreadOf = (id: string) => {
    const i = info[id];
    const b = bookPrices.get(id);
    return { ask: i?.bestSellPrice ?? b?.sell ?? null, bid: i?.bestBuyPrice ?? b?.buy ?? null };
  };

  const refresh = () => {
    if (onRefresh) onRefresh();
    else startTransition(() => router.refresh());
  };
  const busy = refreshing ?? pending;

  return (
    <Card className="gap-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          Live {sideWord} ads whose minimum order is close to {usingMine ? "your ad's" : "your chosen"} minimum: the ads a
          taker with the same order size sees next to yours. Best for the taker first.
        </p>
        <InfoPopover label="How competitors are picked" title="How competitors are picked">
          <p>
            Same side as your ad, minimum order within the band of the reference minimum (±25% of {S} 50,000 = {S}{" "}
            37,500–62,500). With &ldquo;online &amp; unrestricted only&rdquo; on, offline ads and ads with taker
            conditions are left out. Ads that can&apos;t fill an order, use a different bank rail, or don&apos;t overlap
            your max order (when set) are left out too: the same rules as the ad placement helper.
          </p>
          <p>
            Rank counts the ads priced strictly better for the taker (Sell ads: lower; Buy ads: higher); equal prices
            share a rank and have no guaranteed order. &ldquo;To be #1&rdquo; is one price tick ({S} {tick}) better
            than the best competitor.
          </p>
          <p>
            Their own spread = their best Sell-ad price − their best Buy-ad price. Reliability is our 0–100 score.
            Release time and feedback come from the Binance profile when we have it.
          </p>
        </InfoPopover>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {pickable && (
          <Field label="Merchant" className="sm:col-span-2 xl:col-span-1">
            <MerchantPicker
              value={picked}
              name={meName}
              options={merchants}
              onChange={(id) => {
                setPicked(id);
                setMode(id ? "mine" : "custom");
              }}
            />
          </Field>
        )}
        <Field label="Compare my" className={cn(!pickable && "sm:col-span-2 xl:col-span-1")}>
          <Segmented<TradeType>
            label="Ad side"
            value={side}
            onChange={setSide}
            className="w-full"
            options={[
              { value: "SELL", label: "Sell ad", className: "flex-1" },
              { value: "BUY", label: "Buy ad", className: "flex-1" },
            ]}
          />
        </Field>
        <Field label="Reference minimum">
          <Segmented<"mine" | "custom">
            label="Reference minimum"
            value={me ? mode : "custom"}
            onChange={setMode}
            className="w-full"
            options={
              me
                ? [
                    { value: "mine", label: "My ad's minimum", className: "flex-1" },
                    { value: "custom", label: "Custom", className: "flex-1" },
                  ]
                : [{ value: "custom", label: "Custom amount", className: "flex-1" }]
            }
          />
        </Field>
        <Field label="Minimum within">
          <Segmented<string>
            label="Closeness band"
            value={String(band)}
            onChange={(v) => {
              const b = MIN_BANDS.find((x) => String(x) === v);
              if (b !== undefined) setBand(b);
            }}
            className="w-full"
            options={MIN_BANDS.map((b) => ({ value: String(b), label: bandLabel(b), className: "flex-1" }))}
          />
        </Field>
      </div>

      {(!me || mode === "custom" || !mine) && (
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-4">
          <Field label={`Custom minimum (${S})`} className="md:w-44">
            <Input
              type="text"
              inputMode="numeric"
              value={customStr}
              onChange={(e) => setCustomStr(e.target.value)}
              className="h-10 font-mono tabular-nums md:h-8"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Minimum presets">
            {MIN_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCustomStr(String(p))}
                aria-pressed={custom === p}
                className={cn(
                  "h-10 min-w-12 rounded-md border px-3 font-mono text-xs tabular-nums transition-colors md:h-8",
                  custom === p
                    ? "border-foreground/30 bg-muted text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {formatCompact(p)}
              </button>
            ))}
          </div>
        </div>
      )}
      {me && mode === "mine" && !mine && (
        <p className="text-xs text-[color:var(--color-warn)]">
          {meName ?? "This merchant"} has no {sideWord} ad on the live book right now, so the custom minimum is used.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={`Max order (${S}, optional)`}>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="Any"
            value={maxStr}
            onChange={(e) => setMaxStr(e.target.value)}
            aria-invalid={badMax || undefined}
            className="h-10 font-mono tabular-nums md:h-8"
          />
        </Field>
        <Field label="Bank rail">
          <Select value={payType || NONE} onValueChange={(v) => setPayType(!v || v === NONE ? "" : String(v))}>
            <SelectTrigger className="h-10 w-full data-[size=default]:h-10 md:data-[size=default]:h-8" aria-label={`Bank rail: ${payTypes.find((p) => p.id === payType)?.label ?? "Any rail"}`}>
              <SelectValue>
                {(v) => (v === NONE || !v ? "Any rail" : (payTypes.find((p) => p.id === v)?.label ?? String(v)))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any rail</SelectItem>
              {payTypes.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Label
          htmlFor="cc-online"
          className="flex min-h-10 cursor-pointer items-center gap-2 self-end text-sm font-normal sm:col-span-2 lg:col-span-1"
        >
          <Switch id="cc-online" checked={onlineOnly} onCheckedChange={(v) => setOnlineOnly(Boolean(v))} />
          Online &amp; unrestricted only
        </Label>
      </div>
      {badMax && <p className="text-xs text-[color:var(--color-warn)]">Max order is below the minimum; it&apos;s ignored.</p>}

      <Summary result={result} sideWord={sideWord} priceTone={priceTone} refMin={refMin} band={band} meName={meName} hasMe={me != null} />

      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No {sideWord} ads match. Widen the band or switch off &ldquo;online &amp; unrestricted only&rdquo;.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border xl:hidden">
            {shown.map((r) => (
              <RowCard key={r.ad.id} r={r} priceTone={priceTone} spread={spreadOf(r.ad.merchant.id)} info={info[r.ad.merchant.id]} />
            ))}
          </ul>

          <div className="hidden rounded-lg border border-border xl:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-3 text-right">#</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">vs you</TableHead>
                  <TableHead className="text-right">Order limits</TableHead>
                  <TableHead className="hidden text-right 2xl:table-cell">Available</TableHead>
                  <TableHead className="text-right">Completion</TableHead>
                  <TableHead className="text-right">30d orders</TableHead>
                  <TableHead className="hidden text-right min-[1400px]:table-cell">Release</TableHead>
                  <TableHead className="hidden text-right min-[1400px]:table-cell">Feedback</TableHead>
                  <TableHead className="text-right">Their spread</TableHead>
                  <TableHead className="pr-3 text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => {
                  const i = info[r.ad.merchant.id];
                  const sp = spreadOf(r.ad.merchant.id);
                  return (
                    <TableRow key={r.ad.id} className={cn(r.isSelf && "bg-muted/60 hover:bg-muted/60")}>
                      <TableCell className="pl-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {r.rank}
                      </TableCell>
                      <TableCell className="max-w-56 py-2">
                        <Who r={r} />
                      </TableCell>
                      <TableCell className={cn("text-right font-mono font-medium tabular-nums", priceTone)}>
                        {r.ad.price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <GapText r={r} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        <Limits ad={r.ad} />
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums 2xl:table-cell">
                        {formatCompact(r.ad.available)} USDT
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatPct(r.ad.merchant.completionRate, { frac: 1 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCount(r.ad.merchant.orders30d)}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums min-[1400px]:table-cell">
                        <Release sec={i?.avgReleaseSec ?? null} />
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums min-[1400px]:table-cell">
                        {i?.positiveRate != null ? formatPct(i.positiveRate, { frac: 1 }) : <Dash />}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <OwnSpreadText ask={sp.ask} bid={sp.bid} stacked />
                      </TableCell>
                      <TableCell className="pr-3 text-right font-mono text-xs tabular-nums">
                        {i?.trustScore != null ? i.trustScore : <Dash />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {result.rows.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="h-10 w-full rounded-lg border border-border text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {showAll ? `Show the top ${VISIBLE}` : `Show all ${result.rows.length}`}
            </button>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {ads.length} live ads{scopeNote ? ` · ${scopeNote}` : ""}
          {bookTs ? ` · book at ${formatSLT(bookTs, { dateStyle: undefined, timeStyle: "short" })} SLT` : ""}
        </span>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden />
          Refresh
        </button>
      </div>
    </Card>
  );
}

function Summary({
  result,
  sideWord,
  priceTone,
  refMin,
  band,
  meName,
  hasMe,
}: {
  result: ReturnType<typeof compareCompetitors>;
  sideWord: string;
  priceTone: string;
  refMin: number;
  band: MinBand;
  meName: string | null;
  hasMe: boolean;
}) {
  const group =
    band == null ? `any minimum order` : `minimum ${S} ${formatCompact(refMin)} ${bandLabel(band)}`;
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm" aria-live="polite">
      {result.self && result.selfRank != null ? (
        <p>
          {meName ? `${meName} ranks` : "You rank"}{" "}
          <span className="font-mono font-semibold tabular-nums">#{result.selfRank}</span> of{" "}
          <span className="font-mono tabular-nums">{result.groupSize}</span> in this group at{" "}
          <span className={cn("font-mono font-medium tabular-nums", priceTone)}>{formatFiat(result.self.price, S, 2)}</span>
          {result.alreadyFirst ? (
            <>
              , already #1
              {result.best != null && (
                <>
                  {" "}
                  (next best {formatFiat(result.best, S, 2)})
                </>
              )}
              .
            </>
          ) : result.toBeFirst != null ? (
            <>
              ; to be #1 post at{" "}
              <span className={cn("font-mono font-semibold tabular-nums", priceTone)}>
                {formatFiat(result.toBeFirst, S, 2)}
              </span>{" "}
              (one tick better than the best).
            </>
          ) : (
            "."
          )}
        </p>
      ) : (
        <p>
          <span className="font-mono font-semibold tabular-nums">{result.competing}</span> competing {sideWord} ad
          {result.competing === 1 ? "" : "s"}
          {hasMe ? ` (${meName ?? "this merchant"} has no ${sideWord} ad in this group)` : ""}
          {result.toBeFirst != null && (
            <>
              ; to be #1 post at{" "}
              <span className={cn("font-mono font-semibold tabular-nums", priceTone)}>
                {formatFiat(result.toBeFirst, S, 2)}
              </span>
            </>
          )}
          .
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Group: {sideWord} ads, {group} · best{" "}
        <span className="font-mono tabular-nums text-foreground">{formatFiat(result.best, S, 2)}</span> · median{" "}
        <span className="font-mono tabular-nums text-foreground">{formatFiat(result.median, S, 2)}</span> ·{" "}
        {result.competing} competitor{result.competing === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function Who({ r }: { r: CompetitorRow }) {
  const m = r.ad.merchant;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Link
        href={`/merchants/${encodeURIComponent(m.id)}`}
        className="-my-2.5 truncate py-2.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
      >
        {m.name}
      </Link>
      <TierBadge tier={deriveMerchantTier({ isMerchant: m.isMerchant, userIdentity: m.userIdentity, vipLevel: m.vipLevel })} size="xs" />
      {r.isSelf && (
        <span className="shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] leading-none font-semibold text-background">
          You
        </span>
      )}
      {r.ad.online === false && <span className="shrink-0 text-[10px] text-muted-foreground">offline</span>}
      {r.ad.restricted && <span className="shrink-0 text-[10px] text-[color:var(--color-warn)]">restricted</span>}
    </div>
  );
}

function GapText({ r }: { r: CompetitorRow }) {
  if (r.isSelf) return <span className="text-muted-foreground">you</span>;
  if (r.gapLkr == null) return <Dash />;
  if (Math.abs(r.gapLkr) < 0.005) return <span className="font-mono tabular-nums">same</span>;
  return (
    <span
      className={cn("font-mono tabular-nums", r.ahead ? "text-[color:var(--color-warn)]" : "text-muted-foreground")}
      title={r.ahead ? "Better for the taker than you" : "Worse for the taker than you"}
    >
      {formatSigned(r.gapLkr)} ({formatPct(r.gapPct, { frac: 2, sign: true })})
    </span>
  );
}

function Limits({ ad }: { ad: NormalizedAd }) {
  const cap = orderCapFiat(ad);
  return (
    <span>
      {formatCompact(ad.minOrder)}–{formatCompact(cap > 0 ? cap : ad.maxOrder)}
    </span>
  );
}

function Release({ sec }: { sec: number | null }) {
  if (sec == null || !(sec > 0)) return <Dash />;
  return <span>{sec < 60 ? `${Math.round(sec)}s` : `${(sec / 60).toFixed(1)}m`}</span>;
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

function RowCard({
  r,
  priceTone,
  spread,
  info,
}: {
  r: CompetitorRow;
  priceTone: string;
  spread: { ask: number | null; bid: number | null };
  info: CompetitorInfo | undefined;
}) {
  return (
    <li className={cn("space-y-2 px-3 py-3", r.isSelf && "bg-muted/60")}>
      <div className="flex items-start gap-2">
        <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{r.rank}</span>
        <div className="min-w-0 flex-1">
          <Who r={r} />
          {!r.isSelf && r.gapLkr != null && (
            <div className="text-[11px] text-muted-foreground">
              <GapText r={r} /> vs you
            </div>
          )}
        </div>
        <span className={cn("shrink-0 font-mono text-sm font-semibold tabular-nums", priceTone)}>{r.ad.price.toFixed(2)}</span>
      </div>
      <dl className="grid grid-cols-3 gap-2 pl-8 text-xs">
        <Cell label={`Limits (${S})`} value={<Limits ad={r.ad} />} />
        <Cell label="Completion" value={formatPct(r.ad.merchant.completionRate, { frac: 1 })} />
        <Cell label="30d orders" value={formatCount(r.ad.merchant.orders30d)} />
        <Cell label="Release" value={<Release sec={info?.avgReleaseSec ?? null} />} />
        <Cell label="Feedback" value={info?.positiveRate != null ? formatPct(info.positiveRate, { frac: 1 }) : <Dash />} />
        <Cell label="Score" value={info?.trustScore ?? <Dash />} />
        <Cell className="col-span-3" label="Their own spread" value={<OwnSpreadText ask={spread.ask} bid={spread.bid} />} />
      </dl>
    </li>
  );
}

function Cell({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function MerchantPicker({
  value,
  name,
  options,
  onChange,
}: {
  value: string | null;
  name: string | null;
  options: { id: string; name: string }[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Merchant: ${value ? (name ?? value) : "None: custom minimum"}`}
          className="inline-flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm md:h-8"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? (name ?? value) : "None: custom minimum"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-0">
          <Command>
            <CommandInput placeholder="Search merchants on the book" />
            <CommandList>
              <CommandEmpty>No merchant on the live book.</CommandEmpty>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.id}`}
                  onSelect={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{o.name}</span>
                  {o.id === value && <Check className="ml-auto size-4" aria-hidden />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear merchant"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground md:size-8"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
