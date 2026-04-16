/**
 * Curated lists used across filter UIs.
 * Source: Binance P2P public surface + frequency of use.
 * These are starter values — extend as needed.
 */

export const ASSETS = ["USDT", "BTC", "ETH", "BNB", "USDC", "FDUSD"] as const;
export type Asset = (typeof ASSETS)[number];

export type FiatOption = {
  code: string;
  name: string;
  symbol: string;
  flag: string; // emoji flag (best-effort)
};

export const FIATS: FiatOption[] = [
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", flag: "🇱🇰" },
  { code: "USD", name: "US Dollar", symbol: "$", flag: "🇺🇸" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", flag: "🇮🇳" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", flag: "🇵🇰" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", flag: "🇧🇩" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", flag: "🇵🇭" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", flag: "🇮🇩" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫", flag: "🇻🇳" },
  { code: "THB", name: "Thai Baht", symbol: "฿", flag: "🇹🇭" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", flag: "🇲🇾" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", flag: "🇳🇬" },
  { code: "ARS", name: "Argentine Peso", symbol: "$", flag: "🇦🇷" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", flag: "🇧🇷" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", flag: "🇹🇷" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", flag: "🇦🇪" },
  { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺" },
  { code: "GBP", name: "British Pound", symbol: "£", flag: "🇬🇧" },
];

export function getFiat(code: string): FiatOption | undefined {
  return FIATS.find((f) => f.code.toUpperCase() === code.toUpperCase());
}

/** Common Binance pay type identifiers per fiat. Used for filter UI.
 *  Keys are upper-case fiat codes, values are pairs of (identifier, label). */
export const PAY_TYPES_BY_FIAT: Record<
  string,
  { id: string; label: string }[]
> = {
  LKR: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "CommercialBankofCeylon", label: "Commercial Bank" },
    { id: "HatBank", label: "Hatton National Bank" },
    { id: "SampathBank", label: "Sampath Bank" },
    { id: "PeoplesBank", label: "People's Bank" },
    { id: "BankofCeylon", label: "Bank of Ceylon" },
  ],
  USD: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "WISE", label: "Wise" },
    { id: "Zelle", label: "Zelle" },
    { id: "PayPal", label: "PayPal" },
    { id: "CashAppPay", label: "Cash App" },
    { id: "Revolut", label: "Revolut" },
  ],
  INR: [
    { id: "UPI", label: "UPI" },
    { id: "IMPS", label: "IMPS" },
    { id: "BANK", label: "Bank Transfer" },
  ],
  PKR: [
    { id: "EasyPaisa", label: "EasyPaisa" },
    { id: "JazzCash", label: "JazzCash" },
    { id: "BANK", label: "Bank Transfer" },
  ],
  BDT: [
    { id: "bKash", label: "bKash" },
    { id: "Nagad", label: "Nagad" },
    { id: "BANK", label: "Bank Transfer" },
  ],
  PHP: [
    { id: "GCASH", label: "GCash" },
    { id: "Maya", label: "Maya" },
    { id: "BANK", label: "Bank Transfer" },
  ],
  IDR: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "DANA", label: "DANA" },
    { id: "OVO", label: "OVO" },
  ],
  VND: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "Momo", label: "MoMo" },
    { id: "ZaloPay", label: "ZaloPay" },
  ],
  NGN: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "OPAY", label: "OPay" },
  ],
  TRY: [
    { id: "Papara", label: "Papara" },
    { id: "BANK", label: "Bank Transfer" },
  ],
  AED: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "WISE", label: "Wise" },
  ],
  EUR: [
    { id: "SEPA", label: "SEPA" },
    { id: "Revolut", label: "Revolut" },
    { id: "WISE", label: "Wise" },
  ],
  GBP: [
    { id: "WISE", label: "Wise" },
    { id: "Revolut", label: "Revolut" },
    { id: "BANK", label: "Bank Transfer" },
  ],
};

export const MERCHANT_TYPES = [
  { id: "merchant", label: "Verified merchants" },
  { id: "all", label: "All publishers" },
] as const;

export type MerchantTypeId = (typeof MERCHANT_TYPES)[number]["id"];

/** Default set of fiats to scan for cross-country arbitrage. */
export const DEFAULT_ARB_FIATS = [
  "LKR",
  "INR",
  "PKR",
  "BDT",
  "PHP",
  "IDR",
  "NGN",
  "TRY",
  "VND",
  "THB",
];
