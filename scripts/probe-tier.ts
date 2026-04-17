/**
 * Probe: dump raw advertiser fields from Binance's P2P API for the LKR
 * market so we can match field values against what Binance's own UI renders
 * (bronze / silver / gold badges).
 *
 * Run:  npm run probe:tier
 */

const ENDPOINT =
  "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

async function fetchSide(tradeType: "BUY" | "SELL", page: number) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      clienttype: "web",
    },
    body: JSON.stringify({
      asset: "USDT",
      fiat: "LKR",
      tradeType,
      page,
      rows: 20,
      payTypes: ["BANK", "BankSriLanka"],
      publisherType: null,
      merchantCheck: false,
      transAmount: "",
      countries: [],
      proMerchantAds: false,
      shieldMerchantAds: false,
    }),
  });
  if (!res.ok) throw new Error(`${tradeType} page ${page}: ${res.status}`);
  const json = await res.json();
  return (json.data as unknown[]) ?? [];
}

async function main() {
  const all = new Map<string, Record<string, unknown>>();
  for (const side of ["BUY", "SELL"] as const) {
    for (let p = 1; p <= 5; p++) {
      const items = await fetchSide(side, p);
      if (items.length === 0) break;
      for (const it of items as Array<{ advertiser: Record<string, unknown> }>) {
        const adv = it.advertiser;
        const id = String(adv.userNo);
        if (!all.has(id)) all.set(id, adv);
      }
      if (items.length < 20) break;
    }
  }

  const rows = Array.from(all.values()).map((adv) => ({
    nickName: adv.nickName,
    userType: adv.userType,
    userIdentity: adv.userIdentity,
    userGrade: adv.userGrade,
    vipLevel: adv.vipLevel,
    monthOrderCount: adv.monthOrderCount,
    monthFinishRate: adv.monthFinishRate,
    // Keep every remaining field so we can spot anything tier-shaped we missed.
    _rawKeys: Object.keys(adv),
    userNo: adv.userNo,
  }));

  // Summary: which (userType, userIdentity, userGrade, vipLevel) combos appear?
  const combos = new Map<string, number>();
  for (const r of rows) {
    const k = `type=${r.userType} identity=${r.userIdentity} grade=${r.userGrade} vip=${r.vipLevel}`;
    combos.set(k, (combos.get(k) ?? 0) + 1);
  }

  console.log(`\n=== ${rows.length} unique advertisers on USDT/LKR ===\n`);
  console.log("Unique (type, identity, grade, vipLevel) combinations:");
  for (const [k, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)} × ${k}`);
  }

  console.log("\nPer-merchant rows (sorted by userGrade):");
  rows
    .sort(
      (a, b) =>
        (Number(b.userGrade ?? 0) - Number(a.userGrade ?? 0)) ||
        String(a.nickName).localeCompare(String(b.nickName)),
    )
    .forEach((r) => {
      console.log(
        `  grade=${String(r.userGrade).padStart(1)} ` +
          `identity=${String(r.userIdentity ?? "—").padEnd(16)} ` +
          `type=${String(r.userType ?? "—").padEnd(10)} ` +
          `vip=${String(r.vipLevel ?? "—").padEnd(3)} ` +
          `orders=${String(r.monthOrderCount ?? "—").padStart(5)} ` +
          `${r.nickName}`,
      );
    });

  console.log(
    "\nAll advertiser keys seen (union): ",
    [...new Set(rows.flatMap((r) => r._rawKeys))].sort(),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
