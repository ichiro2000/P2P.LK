import type { MetadataRoute } from "next";
import { DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "P2P.LK: USDT/LKR P2P rates for Sri Lanka",
    short_name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    // `id` stays "/" forever: changing it makes browsers treat installs as
    // a different app. `start_url` carries a source tag (analytics can tell
    // home-screen launches apart); the page ignores it.
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en-LK",
    dir: "ltr",
    categories: ["finance", "business"],
    // Manifest colours can't use CSS tokens; these match the light theme's
    // background/foreground (black and white brand).
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Live markets",
        short_name: "Markets",
        description: "USDT/LKR P2P order books, live",
        url: "/?source=pwa-shortcut",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Exchange rates",
        short_name: "Rates",
        description: "CBSL and bank USD/LKR rates",
        url: "/rates?source=pwa-shortcut",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Alerts",
        short_name: "Alerts",
        description: "Your price, spread and depth alerts",
        url: "/alerts?source=pwa-shortcut",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
