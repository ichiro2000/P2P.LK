/**
 * Probe: dump raw advertiser fields from Bybit's P2P API for the LKR market
 * so we can match field values against what Bybit's own UI renders (verified
 * tags, completion rate, KYC level, etc.).
 *
 * Run:  npm run probe:tier
 */

const ENDPOINT = "https://api2.bybit.com/fiat/otc/item/online";

async function fetchSide(side: "0" | "1", page: number) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Origin: "https://www.bybit.com",
      Referer: "https://www.bybit.com/",
    },
    body: JSON.stringify({
      userId: 0,
      tokenId: "USDT",
      currencyId: "LKR",
      payment: ["14"],
      side,
      size: "20",
      page: String(page),
      amount: "",
      authMaker: false,
      canTrade: false,
    }),
  });
  if (!res.ok) throw new Error(`side ${side} page ${page}: ${res.status}`);
  const json = (await res.json()) as { result?: { items?: unknown[] } };
  return (json.result?.items as unknown[]) ?? [];
}

async function main() {
  const all = new Map<string, Record<string, unknown>>();
  for (const side of ["0", "1"] as const) {
    for (let p = 1; p <= 5; p++) {
      const items = await fetchSide(side, p);
      if (items.length === 0) break;
      for (const it of items as Array<Record<string, unknown>>) {
        const id = String(it.userId);
        if (!all.has(id)) all.set(id, it);
      }
      if (items.length < 20) break;
    }
  }

  const rows = Array.from(all.values()).map((it) => ({
    nickName: it.nickName,
    userType: it.userType,
    authStatus: it.authStatus,
    authTag: Array.isArray(it.authTag) ? (it.authTag as string[]).join(",") : "",
    orderNum: it.orderNum,
    finishNum: it.finishNum,
    recentOrderNum: it.recentOrderNum,
    recentExecuteRate: it.recentExecuteRate,
    isOnline: it.isOnline,
    payments: Array.isArray(it.payments)
      ? (it.payments as string[]).join(",")
      : "",
    _rawKeys: Object.keys(it),
    userId: it.userId,
  }));

  // Summary: which (userType, authStatus, authTag) combos appear?
  const combos = new Map<string, number>();
  for (const r of rows) {
    const k = `type=${r.userType} authStatus=${r.authStatus} authTag=${r.authTag}`;
    combos.set(k, (combos.get(k) ?? 0) + 1);
  }

  console.log(`\n=== ${rows.length} unique advertisers on USDT/LKR ===\n`);
  console.log("Unique (userType, authStatus, authTag) combinations:");
  for (const [k, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)} × ${k}`);
  }

  console.log("\nPer-merchant rows (sorted by recentOrderNum desc):");
  rows
    .sort(
      (a, b) =>
        Number(b.recentOrderNum ?? 0) - Number(a.recentOrderNum ?? 0) ||
        String(a.nickName).localeCompare(String(b.nickName)),
    )
    .forEach((r) => {
      console.log(
        `  type=${String(r.userType ?? "—").padEnd(10)} ` +
          `authStatus=${String(r.authStatus ?? "—").padEnd(2)} ` +
          `authTag=${String(r.authTag || "—").padEnd(10)} ` +
          `recent=${String(r.recentOrderNum ?? "—").padStart(4)} ` +
          `rate=${String(r.recentExecuteRate ?? "—").padStart(3)}% ` +
          `payments=${String(r.payments || "—").padEnd(8)} ` +
          `${r.nickName}`,
      );
    });

  console.log(
    "\nAll item keys seen (union): ",
    [...new Set(rows.flatMap((r) => r._rawKeys))].sort(),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
