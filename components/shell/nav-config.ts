import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Briefcase,
  Droplets,
  LineChart,
  ShieldAlert,
  Users,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  /** When true, show a "soon" badge and route to a stub page. */
  soon?: boolean;
  description?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Markets",
    items: [
      {
        href: "/",
        label: "Live Markets",
        icon: Activity,
        description: "Best prices, spread, depth — refreshed every 20s",
      },
      {
        href: "/arbitrage",
        label: "Arbitrage",
        icon: ArrowLeftRight,
        description: "Cross-market spread opportunities",
      },
      {
        href: "/historical",
        label: "Historical",
        icon: LineChart,
        description: "Time-series price, depth and distribution",
      },
    ],
  },
  {
    title: "Intelligence",
    items: [
      {
        href: "/merchants",
        label: "Merchants",
        icon: Users,
        description: "Counterparty analytics & trust scores",
      },
      {
        href: "/liquidity",
        label: "Liquidity",
        icon: Droplets,
        description: "Slippage simulator, concentration, depth heatmap",
      },
      {
        href: "/risk",
        label: "Risk",
        icon: ShieldAlert,
        description: "Anomalies and counterparty flags",
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        href: "/alerts",
        label: "Alerts",
        icon: Bell,
        soon: true,
        description: "Price, spread and merchant alerts",
      },
      {
        href: "/workspace",
        label: "Workspace",
        icon: Briefcase,
        soon: true,
        description: "Watchlists, saved filters and notes",
      },
      {
        href: "/reports",
        label: "Reports",
        icon: BarChart3,
        soon: true,
        description: "Exportable market reports",
      },
    ],
  },
];
