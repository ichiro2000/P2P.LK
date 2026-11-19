import { ExchangeProvider } from "@/components/shell/exchange-context";
import { getActiveExchange } from "@/lib/exchange-server";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { JsonLd, siteJsonLd } from "@/components/seo/json-ld";
import { PwaRegister } from "@/components/pwa/pwa-register";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  LOCALE,
  OG_LOCALE,
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/seo";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Root metadata. Deliberately NO `alternates.canonical` here: it would
// cascade to every page that forgets its own and mark them all as duplicates
// of the homepage. Each page sets a self-canonical via `pageMetadata()`.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: TITLE_TEMPLATE },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  // iOS "Add to Home Screen": full-screen app with this title. "default"
  // keeps the status bar out of the page (no content under it). The icon
  // comes from app/apple-icon.png.
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "finance",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: OG_LOCALE,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  other: { "geo.region": "LK", "geo.placename": "Sri Lanka" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const exchange = await getActiveExchange();
  return (
    <html
      lang={LOCALE}
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground font-sans">
        <JsonLd data={siteJsonLd()} />
        <ThemeProvider>
          <ExchangeProvider initial={exchange}>
            <TooltipProvider delay={150}>{children}</TooltipProvider>
          </ExchangeProvider>
          <PwaRegister />
          <Toaster
            position="top-center"
            toastOptions={{
              className: "border border-border bg-card text-card-foreground shadow-lg",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
