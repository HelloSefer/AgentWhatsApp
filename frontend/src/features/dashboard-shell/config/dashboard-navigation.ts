import {
  BarChart3,
  CircleHelp,
  Home,
  MessageCircle,
  MessageSquareText,
  Package,
  Settings,
  ShoppingBag,
} from "lucide-react";
import type { DashboardNavigationSection, DashboardPageMeta } from "../types/dashboard-navigation.types";

export const dashboardNavigationSections = [
  {
    label: "Overview",
    items: [
      {
        label: "Overview",
        href: "/dashboard",
        icon: Home,
        match: "exact",
        status: "available",
      },
    ],
  },
  {
    label: "Commerce operations",
    items: [
      {
        label: "Store",
        icon: ShoppingBag,
        status: "soon",
      },
      {
        label: "Orders",
        icon: Package,
        status: "soon",
      },
    ],
  },
  {
    label: "Customer communication",
    items: [
      {
        label: "WhatsApp",
        href: "/dashboard/settings/whatsapp",
        icon: MessageCircle,
        match: "prefix",
        status: "available",
        requiredPermission: "workspace:whatsapp:manage",
      },
      {
        label: "Conversations",
        icon: MessageSquareText,
        status: "soon",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Analytics",
        icon: BarChart3,
        status: "soon",
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        label: "Settings",
        icon: Settings,
        status: "soon",
      },
      {
        label: "Help",
        icon: CircleHelp,
        status: "soon",
      },
    ],
  },
] as const satisfies readonly DashboardNavigationSection[];

export const dashboardPageMeta = [
  {
    href: "/dashboard",
    match: "exact",
    meta: {
      title: "Overview",
    },
  },
  {
    href: "/dashboard/settings/whatsapp",
    match: "prefix",
    meta: {
      title: "WhatsApp connection",
      breadcrumb: ["Settings", "WhatsApp"],
    },
  },
] as const satisfies readonly {
  href: string;
  match: "exact" | "prefix";
  meta: DashboardPageMeta;
}[];
