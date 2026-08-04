"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Boxes, CircleAlert, Loader2, MessageCircle, RefreshCw, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { DevelopmentTenantHttpError, developmentTenantService, developmentTenantStatusQueryKey } from "../services/development-tenant-service";
import type { DevelopmentTenantReadiness } from "../types/development-tenant.types";

function message(error: unknown): string { if (!(error instanceof DevelopmentTenantHttpError)) return "Development tools could not be reached. Try again."; if (error.status === 401 || error.status === 403) return "Development tools are unavailable for this workspace."; if (error.status === 404) return "Development tools are unavailable in this environment."; if (error.issueCode === "NOT_CONFIGURED" || error.status === 409) return "No Development Tenant is configured yet."; return "Development tools are temporarily unavailable. Try again."; }
function summary(status: DevelopmentTenantReadiness["status"]): { label: string; copy: string; tone: "default" | "secondary" | "destructive" } { if (status === "READY") return { label: "Ready", copy: "Ready for conversation, order and receipt testing.", tone: "default" }; if (status === "NOT_CONFIGURED") return { label: "Not configured", copy: "An internal development workspace has not been configured.", tone: "secondary" }; return { label: "Needs attention", copy: "Complete the items below before testing.", tone: "destructive" }; }
function cards(data: DevelopmentTenantReadiness) { return [
  ["Development workspace", data.configured ? "Configured" : "Not configured", ShieldCheck],
  ["WhatsApp", data.connectionStatus === "ACTIVE" ? "Connected and healthy" : "Connection required", MessageCircle],
  ["Products", `${data.productCount} configured`, Boxes],
  ["Conversation setup", data.conversationConfigAvailable ? "Ready" : "Needs setup", Sparkles],
  ["Receipt branding", data.receiptBrandingAvailable ? "Ready" : "Needs setup", BadgeCheck],
  ["Agent readiness", data.runtimeReady ? "Ready for testing" : "Needs attention", CircleAlert],
] as const; }
export function DevelopmentTenantPage() {
  const queryClient = useQueryClient(); const { memberships } = useAuthSession(); const role = memberships[0]?.role; const canReset = role === "OWNER" || role === "ADMIN";
  const [confirming, setConfirming] = useState(false); const [lastReset, setLastReset] = useState<number | null>(null);
  const statusQuery = useQuery({ queryKey: developmentTenantStatusQueryKey, queryFn: developmentTenantService.loadStatus, retry: false, refetchOnWindowFocus: false });
  const reset = useMutation({ mutationFn: developmentTenantService.resetConversation, onSuccess: async (result) => { setLastReset(result.deletedKeyCount); setConfirming(false); toast.success(result.deletedKeyCount === 0 ? "Test conversation was already clear." : `Test conversation reset. ${result.deletedKeyCount} temporary items cleared.`); await queryClient.invalidateQueries({ queryKey: developmentTenantStatusQueryKey }); }, onError: (error) => toast.error(message(error)) });
  const data = statusQuery.data; const unavailable = statusQuery.error ? message(statusQuery.error) : null;
  return <section aria-labelledby="development-tenant-heading" className="mx-auto w-full max-w-[1120px] space-y-5">
    <header className="flex flex-col gap-4 rounded-xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)] sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Settings / Internal tools</p><h1 id="development-tenant-heading" className="mt-2 text-2xl font-semibold">Development Tenant</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Internal environment for testing AgentWhatsApp conversations, orders and receipts.</p></div>
      {data ? <Badge variant={summary(data.status).tone}>{summary(data.status).label}</Badge> : null}
    </header>
    {statusQuery.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton className="h-28 rounded-xl" key={index} />)}</div> : unavailable ? <Card><CardContent className="flex flex-col gap-4 p-6" role="alert"><CircleAlert className="size-6 text-muted-foreground"/><div><h2 className="font-semibold">Internal tools unavailable</h2><p className="mt-1 text-sm text-muted-foreground">{unavailable}</p></div><Button className="w-full sm:w-auto" onClick={() => void statusQuery.refetch()} type="button" variant="outline"><RefreshCw/>Retry</Button></CardContent></Card> : data ? <>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><BadgeCheck className="text-marketing-primary"/> {summary(data.status).label}</CardTitle><CardDescription>{summary(data.status).copy}</CardDescription></CardHeader></Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards(data).map(([label, value, Icon]) => <Card key={label}><CardContent className="flex items-start gap-3 p-4"><Icon aria-hidden="true" className="mt-0.5 size-5 text-marketing-primary"/><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div></CardContent></Card>)}</div>
      {data.status === "CONNECTION_REQUIRED" ? <Card><CardContent className="p-4 text-sm leading-6">A verified WhatsApp connection is required before testing. <Link className="font-semibold text-marketing-primary underline" href="/dashboard/settings/whatsapp">Open WhatsApp settings</Link>.</CardContent></Card> : null}
      {(data.status === "COMMERCE_REQUIRED" || data.status === "DEGRADED") ? <Card><CardContent className="flex gap-3 p-4 text-sm leading-6"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600"/><div><p className="font-semibold">Setup needs attention</p><p className="text-muted-foreground">{data.blockers.length ? "Complete the required setup before using test conversations." : "The environment is not ready for testing yet."}</p></div></CardContent></Card> : null}
      {data.status === "READY" ? <Card className="border-emerald-200 bg-emerald-50/50"><CardHeader><CardTitle>Reset test conversation</CardTitle><CardDescription>Clears temporary conversation, cart and order-flow state so testing can start from a clean first message. Products, confirmed orders, WhatsApp connection and settings stay unchanged.</CardDescription></CardHeader><CardContent><Button className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" disabled={!canReset || reset.isPending} onClick={() => setConfirming(true)} type="button"><RotateCcw/>{reset.isPending ? "Resetting…" : "Reset test conversation"}</Button>{!canReset ? <p className="mt-2 text-sm text-muted-foreground">Only workspace owners and admins can reset test conversations.</p> : null}{lastReset !== null ? <p aria-live="polite" className="mt-3 text-sm text-emerald-900">{lastReset === 0 ? "No temporary state needed clearing." : `${lastReset} temporary items cleared.`}</p> : null}</CardContent></Card> : null}
    </> : null}
    <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogHeader><DialogTitle>Reset test conversation?</DialogTitle><DialogDescription>This clears only temporary conversation and cart state for the Development Tenant. Products, confirmed orders, WhatsApp connection and settings will stay unchanged.</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button disabled={reset.isPending} type="button" variant="outline"/>}>Cancel</DialogClose><Button disabled={reset.isPending} onClick={() => reset.mutate()} type="button">{reset.isPending ? <Loader2 className="animate-spin"/> : <RotateCcw/>}Reset conversation</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
