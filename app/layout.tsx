import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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

export const metadata: Metadata = {
  title: {
    default: "P2P · Wise — Bybit USD/Wise P2P Analytics",
    template: "%s · P2P·Wise",
  },
  description:
    "Live Bybit P2P analytics for USDT/USD via Wise — prices, spread, merchant trust, liquidity, top sellers per ticket size and anomaly detection.",
  applicationName: "P2P·Wise",
  keywords: [
    "Bybit P2P",
    "USD USDT",
    "Wise crypto",
    "Wise USDT",
    "P2P merchant analytics",
  ],
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground font-sans">
        <TooltipProvider delay={150}>{children}</TooltipProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            className:
              "border border-border bg-card text-card-foreground shadow-lg",
          }}
        />
      </body>
    </html>
  );
}
