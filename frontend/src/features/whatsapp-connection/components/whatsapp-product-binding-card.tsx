"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PackageOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { useSellerProducts } from "@/features/seller-products/hooks/use-seller-products";
import { formatMad } from "@/features/seller-products/utils/product-money";
import { useBindWhatsappProduct, useClearWhatsappProductBinding, useWhatsappProductBinding } from "../hooks/use-whatsapp-product-binding";
import { WhatsAppProductBindingServiceError } from "../services/whatsapp-product-binding-service";
import type { WhatsAppCommerceReadinessReason } from "../types/whatsapp-product-binding-contracts";

const canManage = (role: string | undefined) => role === "OWNER" || role === "ADMIN";
const readinessCopy: Record<WhatsAppCommerceReadinessReason, Readonly<{ title: string; description: string }>> = {
  READY: { title: "Ready", description: "This WhatsApp number is connected to an available product and is ready for customer conversations." },
  PRODUCT_UNBOUND: { title: "Product required", description: "Choose the product this WhatsApp number will sell." },
  PRODUCT_UNAVAILABLE: { title: "Product unavailable", description: "The selected product is still connected, but customers cannot order it until it becomes available." },
  CONNECTION_NOT_ACTIVE: { title: "Readiness not evaluated", description: "This is not the currently active WhatsApp connection." },
  CONNECTION_NOT_READY: { title: "WhatsApp connection not ready", description: "Complete or repair the WhatsApp connection before using this product." },
  COMMERCE_CONFIGURATION_REQUIRED: { title: "Store settings required", description: "Complete the required commerce settings." },
  CONVERSATION_CONFIGURATION_REQUIRED: { title: "Conversation setup required", description: "Complete the required conversation setup." },
  COMMERCE_CONFIGURATION_INVALID: { title: "Store settings need attention", description: "Review the current commerce configuration." },
};
function errorMessage(error: unknown): string {
  if (!(error instanceof WhatsAppProductBindingServiceError)) return "Product binding is temporarily unavailable. Try again.";
  if (error.status === 404) return error.message;
  if (error.status === 403) return "Your permission changed. You can view this binding but cannot change it.";
  return error.message;
}

export function WhatsappProductBindingCard({ connectionId }: Readonly<{ connectionId: string }>) {
  const { memberships } = useAuthSession(); const manager = canManage(memberships[0]?.role);
  const binding = useWhatsappProductBinding(connectionId); const products = useSellerProducts();
  const bind = useBindWhatsappProduct(connectionId); const clear = useClearWhatsappProductBinding(connectionId);
  const [selectedId, setSelectedId] = useState(""); const [clearOpen, setClearOpen] = useState(false);
  const loadedProducts = useMemo(() => (products.data?.pages.flatMap((page) => page.products) ?? []).filter((item, index, all) => all.findIndex((candidate) => candidate.productId === item.productId) === index), [products.data]);
  const effectiveSelectedId = selectedId || binding.data?.binding.product?.productId || "";
  const selected = loadedProducts.find((item) => item.productId === effectiveSelectedId) ?? null;
  if (!connectionId) return null;
  if (binding.isLoading) return <Card><CardContent className="flex min-h-32 items-center gap-3 p-5" role="status"><Loader2 className="animate-spin" /><p className="text-sm text-muted-foreground">Loading product binding.</p></CardContent></Card>;
  if (binding.error) return <Card><CardHeader><CardTitle>Product binding</CardTitle><CardDescription>Choose which Product this WhatsApp number sells.</CardDescription></CardHeader><CardContent className="space-y-3" role="alert"><p className="text-sm text-muted-foreground">{errorMessage(binding.error)}</p><Button type="button" variant="outline" onClick={() => void binding.refetch()}><RefreshCw />Retry</Button></CardContent></Card>;
  const value = binding.data; if (!value) return null;
  const current = value.binding.product; const readiness = readinessCopy[value.commerceReadiness.reasonCode]; const emptyProducts = !products.isLoading && !products.error && loadedProducts.length === 0;
  const submitBind = () => { if (!effectiveSelectedId || bind.isPending) return; bind.mutate(effectiveSelectedId, { onSuccess: (result) => { setSelectedId(result.binding.product?.productId ?? ""); toast.success("Product binding saved."); }, onError: (error) => toast.error(errorMessage(error)) }); };
  const submitClear = () => { if (clear.isPending) return; clear.mutate(undefined, { onSuccess: () => { setClearOpen(false); setSelectedId(""); toast.success("Product binding cleared."); }, onError: (error) => toast.error(errorMessage(error)) }); };
  return <Card className="rounded-lg border-marketing-border bg-marketing-surface shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)]"><CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Commerce</p><CardTitle className="mt-2 text-xl">Product binding</CardTitle><CardDescription className="mt-2">Choose which Product this WhatsApp number sells.</CardDescription></div><PackageOpen className="size-5 text-marketing-primary" /></CardHeader><CardContent className="space-y-5">
    <div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-marketing-border bg-marketing-canvas p-4"><p className="text-xs font-medium text-muted-foreground">Current product</p>{current ? <div className="mt-2 flex flex-wrap items-center gap-2"><p className="font-semibold">{current.name}</p><Badge variant={current.availability === "available" ? "default" : "secondary"}>{current.availability === "available" ? "Available" : "Unavailable"}</Badge><Link className="text-sm font-medium text-marketing-primary underline-offset-4 hover:underline" href={`/dashboard/products/${encodeURIComponent(current.productId)}`}>Open product</Link></div> : <p className="mt-2 text-sm text-muted-foreground">No product is connected to this WhatsApp number.</p>}{current?.availability === "unavailable" ? <p className="mt-2 text-sm text-amber-800">Customers cannot order this product until it becomes available.</p> : null}</div><div className="rounded-lg border border-marketing-border bg-background p-4"><div className="flex items-center gap-2"><CheckCircle2 className={value.commerceReadiness.ready ? "size-4 text-marketing-primary" : "size-4 text-muted-foreground"} /><p className="text-xs font-medium text-muted-foreground">Readiness</p></div><p className="mt-2 font-semibold">{readiness.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{readiness.description}</p></div></div>
    {products.error ? <div className="rounded-lg border border-marketing-border bg-background p-4"><p className="text-sm text-muted-foreground">Products could not be loaded. The current binding remains available above.</p><Button className="mt-3" type="button" variant="outline" onClick={() => void products.refetch()}><RefreshCw />Retry products</Button></div> : null}
    {emptyProducts ? <div className="rounded-lg border border-marketing-border bg-background p-4"><p className="font-semibold">No products are configured</p><p className="mt-1 text-sm text-muted-foreground">{manager ? "Create a Product first, then return here to connect it." : "A workspace manager needs to configure a Product before this number can sell."}</p><div className="mt-3 flex flex-wrap gap-2"><Button render={<Link href="/dashboard/products" />} type="button" variant="outline">Manage products</Button>{manager ? <Button render={<Link href="/dashboard/products/new" />} type="button">Add product</Button> : null}</div></div> : null}
    {!emptyProducts && !products.error ? <div className="space-y-3 rounded-lg border border-marketing-border bg-background p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><label className="text-sm font-medium" htmlFor="binding-product">Select product</label><select className="mt-1 h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" disabled={!manager || products.isLoading || bind.isPending || clear.isPending} id="binding-product" value={effectiveSelectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose a product</option>{loadedProducts.map((item) => <option key={item.productId} value={item.productId}>{item.name} — {formatMad(item.price.amountMinor)} — {item.availability}</option>)}</select></div>{manager ? <Button disabled={!effectiveSelectedId || bind.isPending || clear.isPending} onClick={submitBind} type="button">{bind.isPending ? <Loader2 className="animate-spin" /> : null}{current ? "Save change" : "Bind product"}</Button> : null}</div>{selected?.availability === "unavailable" ? <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" />This product can be connected, but customers cannot order it until it becomes available.</div> : null}{products.hasNextPage ? <Button disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()} type="button" variant="outline">{products.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null}Load more products</Button> : null}<div className="flex flex-wrap gap-3 text-sm"><Link className="font-medium text-marketing-primary underline-offset-4 hover:underline" href="/dashboard/products">Manage products</Link>{manager ? <Link className="font-medium text-marketing-primary underline-offset-4 hover:underline" href="/dashboard/products/new">Add product</Link> : null}</div>{!manager ? <p className="text-sm text-muted-foreground">You can view this binding, but only workspace owners and administrators can change it.</p> : null}</div> : null}
    {manager && current ? <Button disabled={bind.isPending || clear.isPending} onClick={() => setClearOpen(true)} type="button" variant="destructive">{clear.isPending ? <Loader2 className="animate-spin" /> : null}Clear binding</Button> : null}
    <Dialog open={clearOpen} onOpenChange={setClearOpen}><DialogContent><DialogHeader><DialogTitle>Clear product binding?</DialogTitle><DialogDescription>This WhatsApp number will remain connected, but the Agent will not be ready to sell until another product is selected.</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose><Button disabled={clear.isPending} onClick={submitClear} type="button" variant="destructive">{clear.isPending ? <Loader2 className="animate-spin" /> : null}Clear binding</Button></DialogFooter></DialogContent></Dialog>
  </CardContent></Card>;
}
