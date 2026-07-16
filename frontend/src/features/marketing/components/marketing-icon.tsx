import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BrainCircuit,
  ClipboardList,
  Clock3,
  Cloud,
  FolderCheck,
  Languages,
  Link2,
  ListChecks,
  MessageCircleMore,
  MessageSquareText,
  PackageSearch,
  ReceiptText,
  Rocket,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketingIconName } from "../types/marketing.types";

const icons: Readonly<Record<MarketingIconName, LucideIcon>> = {
  cloud: Cloud,
  commerce: ShoppingBag,
  language: Languages,
  message: MessageCircleMore,
  timer: Clock3,
  list: ClipboardList,
  brain: BrainCircuit,
  reply: MessageSquareText,
  collect: ListChecks,
  check: BadgeCheck,
  folder: FolderCheck,
  sliders: SlidersHorizontal,
  receipt: ReceiptText,
  package: PackageSearch,
  link: Link2,
  rocket: Rocket,
};

type MarketingIconProps = Readonly<{
  name: MarketingIconName;
  className?: string;
}>;

export function MarketingIcon({ name, className }: MarketingIconProps) {
  const Icon = icons[name];

  return <Icon aria-hidden="true" className={cn("size-5", className)} />;
}
