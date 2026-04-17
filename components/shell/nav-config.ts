import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Droplets,
  LineChart,
  ShieldAlert,
  Users,
  UserX,
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
        description: "Best LKR prices, spread, depth — refreshed every 20s",
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
      {
        href: "/suspicious",
        label: "Suspicious",
        icon: UserX,
        description: "Community registry of flagged Binance takers",
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
        description: "Price, spread and depth rules",
      },
      {
        href: "/workspace",
        label: "Workspace",
        icon: Briefcase,
        description: "Watchlists, saved filters and recents",
      },
      {
        href: "/reports",
        label: "Reports",
        icon: BarChart3,
        description: "CSV exports: daily recap & merchant scorecard",
      },
    ],
  },
];
