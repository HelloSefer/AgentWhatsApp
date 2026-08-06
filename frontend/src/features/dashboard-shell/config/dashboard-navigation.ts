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
        label: "Products",
        href: "/dashboard/products",
        icon: ShoppingBag,
        match: "prefix",
        status: "available",
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
        href: "/dashboard/settings",
        icon: Settings,
        match: "exact",
        status: "available",
        requiredPermission: "settings:manage",
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
    href: "/dashboard/products/new",
    match: "exact",
    meta: { title: "Add product", breadcrumb: ["Commerce operations", "Products", "Add product"] },
  },
  {
    href: "/dashboard/products",
    match: "exact",
    meta: { title: "Products", breadcrumb: ["Commerce operations", "Products"] },
  },
  {
    href: "/dashboard/products",
    match: "prefix",
    meta: { title: "Product details", breadcrumb: ["Commerce operations", "Products", "Product details"] },
  },
  {
    href: "/dashboard",
    match: "exact",
    meta: {
      title: "Overview",
    },
  },
  {
    href: "/dashboard/settings",
    match: "exact",
    meta: {
      title: "Settings",
      breadcrumb: ["Configuration", "Settings"],
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
  {
    href: "/dashboard/settings/development",
    match: "prefix",
    meta: {
      title: "Development Tenant",
      breadcrumb: ["Settings", "Development Tenant"],
    },
  },
] as const satisfies readonly {
  href: string;
  match: "exact" | "prefix";
  meta: DashboardPageMeta;
}[];
