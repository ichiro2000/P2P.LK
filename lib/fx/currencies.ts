/**
 * Currencies we store and show on /rates, with a rough LKR reference value
 * per unit used only for sanity checks (a parsed value must sit within
 * 0.5×–2× of it; USD has the explicit 150–600 band). The references are
 * deliberately loose so normal drift over years never trips them, while a
 * mis-parsed column (e.g. a JPY number landing in the KWD row) always does.
 */
export const FX_CURRENCIES = {
  USD: { name: "US Dollar", ref: 330 },
  EUR: { name: "Euro", ref: 365 },
  GBP: { name: "British Pound", ref: 437 },
  JPY: { name: "Japanese Yen", ref: 2.1 },
  AUD: { name: "Australian Dollar", ref: 222 },
  CAD: { name: "Canadian Dollar", ref: 232 },
  CHF: { name: "Swiss Franc", ref: 393 },
  CNY: { name: "Chinese Yuan", ref: 50 },
  SGD: { name: "Singapore Dollar", ref: 258 },
  HKD: { name: "Hong Kong Dollar", ref: 42.7 },
  NZD: { name: "New Zealand Dollar", ref: 183 },
  INR: { name: "Indian Rupee", ref: 3.56 },
  AED: { name: "UAE Dirham", ref: 90.6 },
  SAR: { name: "Saudi Riyal", ref: 88.7 },
  QAR: { name: "Qatari Riyal", ref: 91.4 },
  KWD: { name: "Kuwaiti Dinar", ref: 1085 },
  OMR: { name: "Omani Rial", ref: 865 },
  BHD: { name: "Bahraini Dinar", ref: 885 },
  JOD: { name: "Jordanian Dinar", ref: 469 },
  MYR: { name: "Malaysian Ringgit", ref: 81 },
  THB: { name: "Thai Baht", ref: 10.2 },
  SEK: { name: "Swedish Krona", ref: 33 },
  NOK: { name: "Norwegian Krone", ref: 34.5 },
  DKK: { name: "Danish Krone", ref: 49 },
  KRW: { name: "Korean Won", ref: 0.23 },
} as const;

export type FxCurrency = keyof typeof FX_CURRENCIES;

export function isFxCurrency(v: unknown): v is FxCurrency {
  return typeof v === "string" && Object.hasOwn(FX_CURRENCIES, v);
}

/** Mini cards on the overview, in this order. */
export const HEADLINE_CURRENCIES: FxCurrency[] = ["EUR", "GBP", "JPY", "AUD", "CNY", "INR", "AED", "SAR", "QAR", "SGD", "CAD", "KWD"];

/** Plausible LKR-per-unit band for a currency. */
export function plausibleBand(cur: FxCurrency): [number, number] {
  if (cur === "USD") return [150, 600];
  const ref = FX_CURRENCIES[cur].ref;
  return [ref * 0.5, ref * 2];
}

export function isPlausible(cur: FxCurrency, v: number): boolean {
  if (!Number.isFinite(v) || v <= 0) return false;
  const [lo, hi] = plausibleBand(cur);
  return v >= lo && v <= hi;
}

/** Name fragments → ISO code. Order matters: specific before generic. */
const NAME_RULES: [RegExp, FxCurrency | "CNH"][] = [
  [/\b(us|united states|u s)\s*dollars?\b/, "USD"],
  [/\baustralian\b/, "AUD"],
  [/\bcanadian\b/, "CAD"],
  [/\bsingapore\b/, "SGD"],
  [/\bhong\s*kong\b|\bhongkong\b/, "HKD"],
  [/\bnew zealand\b/, "NZD"],
  [/\beuros?\b/, "EUR"],
  [/\b(pounds?|sterling)\b/, "GBP"],
  [/\byen\b/, "JPY"],
  [/\bswiss\b/, "CHF"],
  [/\boffshore\b/, "CNH"],
  [/\b(yuan|renminbi|rmb)\b/, "CNY"],
  [/\bindian\b/, "INR"],
  [/\b(uae|u a e|emirates?|dirhams?)\b/, "AED"],
  [/\bsaudi\b/, "SAR"],
  [/\bqatar/, "QAR"],
  [/\bkuwait/, "KWD"],
  [/\boman/, "OMR"],
  [/\bbahrain/, "BHD"],
  [/\bjordan/, "JOD"],
  [/\b(malaysian?|ringgit)\b/, "MYR"],
  [/\b(thai|baht)\b/, "THB"],
  [/\bswedish\b|\bswedan\b/, "SEK"],
  [/\bnorw/, "NOK"],
  [/\bdanish\b|\bdenmark\b/, "DKK"],
  [/\bkorea/, "KRW"],
];

/**
 * Resolve a bank's currency label ("US DOLLARS", "Sterling Pound", "USD",
 * "U.A.E Dirham", "Chinese Yuan (CNH)") to one of our codes, or null.
 * Offshore yuan (CNH) is folded into CNY — banks quote one or the other.
 */
export function currencyFromLabel(label: string): FxCurrency | null {
  const raw = label.trim();
  const code = raw.match(/\b([A-Z]{3})\b/)?.[1];
  if (code === "CNH") return "CNY";
  if (code && isFxCurrency(code)) return code;
  const norm = raw
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  for (const [re, cur] of NAME_RULES) {
    if (re.test(norm)) return cur === "CNH" ? "CNY" : cur;
  }
  return null;
}
