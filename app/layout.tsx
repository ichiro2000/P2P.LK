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
    default: "P2P.LK — Binance P2P Analytics",
    template: "%s · P2P.LK",
  },
  description:
    "Live Binance P2P market data, cross-market spread finder, and merchant analytics for Sri Lanka and beyond.",
  applicationName: "P2P.LK",
  keywords: [
    "Binance P2P",
    "P2P analytics",
    "LKR USDT",
    "arbitrage",
    "merchant analytics",
    "Sri Lanka crypto",
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
