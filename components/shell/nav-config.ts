import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Columns2,
  Droplets,
  Flag,
  Gauge,
  Inbox,
  Landmark,
  LayoutDashboard,
  Repeat,
  LineChart,
  ScrollText,
  Server,
  ShieldAlert,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Short label for the mobile bottom tab bar. */
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
        short: "Markets",
        icon: Activity,
        description: "Best LKR prices, spread and depth",
      },
      {
        href: "/historical",
        label: "Historical",
        short: "History",
        icon: LineChart,
        description: "Time-series price, depth and distribution",
      },
      {
        href: "/compare",
        label: "Compare",
        icon: Columns2,
        description: "Binance vs Bybit side by side, order-book constructor",
      },
      {
        href: "/arbitrage",
        label: "Arbitrage",
        icon: Repeat,
        description: "Cross-exchange and cross-method spreads, profit calculator",
      },
      {
        href: "/rates",
        label: "Exchange rates",
        short: "Rates",
        icon: Landmark,
        description: "CBSL and bank USD/LKR rates, calculator, P2P premium",
      },
    ],
  },
  {
    title: "Intelligence",
    items: [
      {
        href: "/merchants",
        label: "Merchants",
        short: "Merchants",
        icon: Users,
        description: "Counterparty analytics & reliability scores",
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
        short: "Scams",
        description: "Community registry of flagged takers",
      },
    ],
  },
];

/** Members only (approved accounts and admins). */
export const MEMBER_SECTION: NavSection = {
  title: "My P2P.LK",
  items: [
    {
      href: "/app",
      label: "Dashboard",
      icon: LayoutDashboard,
      description: "Your markets, ranking and alerts at a glance",
    },
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
};

/** Admins only. Also drives the admin sub-nav (components/admin/admin-nav). */
export const ADMIN_SECTION: NavSection = {
  title: "Admin",
  items: [
    {
      href: "/admin",
      label: "Overview",
      icon: Gauge,
      description: "Users, ingest health, registry and database at a glance",
    },
    {
      href: "/admin/members",
      label: "Members",
      icon: UserCheck,
      description: "Approve or reject new accounts",
    },
    {
      href: "/admin/registry",
      label: "Registry",
      icon: Flag,
      description: "Moderate suspicious-registry submissions and reports",
    },
    {
      href: "/admin/removals",
      label: "Removals",
      icon: Inbox,
      description: "Suspicious-registry removal requests",
    },
    {
      href: "/admin/audit",
      label: "Audit log",
      short: "Audit",
      icon: ScrollText,
      description: "Every admin action",
    },
    {
      href: "/admin/system",
      label: "System",
      icon: Server,
      description: "Ingest runs, FX sources, retention, feature flags",
    },
  ],
};

/** Sections a viewer can see: public ones, then member and admin extras. */
export function navSectionsFor(v: { member: boolean; admin: boolean } | null): NavSection[] {
  return [...NAV_SECTIONS, ...(v?.member ? [MEMBER_SECTION] : []), ...(v?.admin ? [ADMIN_SECTION] : [])];
}

/** Tabs on the mobile bottom bar (the last slot is always "More"). Members
 *  swap Scams for their dashboard; the rest stays one tap away in "More". */
export const MOBILE_TABS = ["/", "/merchants", "/historical", "/suspicious"] as const;
export const MEMBER_MOBILE_TABS = ["/", "/merchants", "/historical", "/app"] as const;

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_SECTIONS, MEMBER_SECTION, ADMIN_SECTION].flatMap((s) => s.items);

const EXACT_HREFS = new Set(["/", "/admin"]);

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // Section roots that have their own children in the nav match exactly.
  return EXACT_HREFS.has(href) ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
