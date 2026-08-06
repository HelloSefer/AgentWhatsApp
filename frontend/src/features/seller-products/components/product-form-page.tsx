"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { SellerProductsServiceError } from "../services/seller-products-service";
import { useCreateSellerProduct, useSellerProduct, useUpdateSellerProduct } from "../hooks/use-seller-products";
import type { ProductFormState, ProductOfferForm, ProductOptionForm } from "../types/product-form.types";
import { emptyProductForm, formToCreate, formToWrite, productToForm } from "../utils/product-form-mappers";
import { madInputToMinor } from "../utils/product-money";
import { productErrorMessage } from "../utils/product-error-message";

type ProductFormPageProps = Readonly<{ mode: "create" | "edit"; productId?: string }>;
type FormErrors = Record<string, string>;

const canManage = (role: string | undefined) => role === "OWNER" || role === "ADMIN";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `product-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fieldError = (errors: FormErrors, field: string) => errors[field] ?? errors.body ?? errors.form;

function move<T>(items: readonly T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return [...items];
  const copy = [...items];
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

function localDateValue(value: string) { return value ? value.slice(0, 16) : ""; }

export function ProductFormPage({ mode, productId = "" }: ProductFormPageProps) {
  const router = useRouter();
  const auth = useAuthSession();
  const manager = canManage(auth.memberships[0]?.role);
  const detail = useSellerProduct(mode === "edit" ? productId : "");
  const create = useCreateSellerProduct();
  const update = useUpdateSellerProduct();
  const generatedId = useRef(newId());
  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
  const [baseline, setBaseline] = useState<ProductFormState>(emptyProductForm);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (detail.data) {
      const next = productToForm(detail.data);
      const reset = window.setTimeout(() => {
        setForm(next);
        setBaseline(next);
      }, 0);
      return () => window.clearTimeout(reset);
    }
  }, [detail.data]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [baseline, form]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (mode === "edit" && detail.isLoading) return <div className="space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>;
  if (mode === "edit" && detail.error) return <Card><CardContent className="space-y-4 p-6" role="alert"><p>{productErrorMessage(detail.error)}</p><Button variant="outline" onClick={() => void detail.refetch()}>Retry</Button></CardContent></Card>;
  if (mode === "create" && !manager) return <Card className="mx-auto max-w-3xl"><CardHeader><CardTitle>Read-only product access</CardTitle><CardDescription>Only workspace owners and administrators can add products. You can still review existing products from the Products list.</CardDescription></CardHeader></Card>;

  const readOnly = !manager;
  const mutationPending = create.isPending || update.isPending;
  const setValue = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const validate = () => {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = "Enter a product name.";
    if (madInputToMinor(form.priceMad) === null) next.price = "Enter a valid MAD amount with up to two decimals.";
    const optionIds = new Set<string>();
    const valueIds = new Set<string>();
    form.options.forEach((option, optionIndex) => {
      if (!option.optionId || optionIds.has(option.optionId)) next[`options.${optionIndex}.optionId`] = "Option identity must be unique.";
      optionIds.add(option.optionId);
      if (!option.label.trim()) next[`options.${optionIndex}.label`] = "Enter an option label.";
      if (!option.values.length) next[`options.${optionIndex}.values`] = "Add at least one value.";
      option.values.forEach((value, valueIndex) => {
        if (!value.valueId || valueIds.has(value.valueId)) next[`options.${optionIndex}.values.${valueIndex}.valueId`] = "Value identity must be unique.";
        valueIds.add(value.valueId);
        if (!value.label.trim()) next[`options.${optionIndex}.values.${valueIndex}.label`] = "Enter a value label.";
      });
    });
    const normalizedAliases = new Set<string>();
    form.aliases.forEach((alias, index) => {
      const normalized = alias.trim().toLocaleLowerCase();
      if (!normalized) next[`aliases.${index}`] = "Enter an alias or remove this row.";
      else if (normalizedAliases.has(normalized)) next[`aliases.${index}`] = "This alias is already listed.";
      normalizedAliases.add(normalized);
    });
    form.offers.forEach((offer, index) => {
      if (!offer.label.trim()) next[`offers.${index}.label`] = "Enter an offer label.";
      if (!/^\d+$/u.test(offer.requiredItemCount) || Number(offer.requiredItemCount) < 1) next[`offers.${index}.requiredItemCount`] = "Enter a positive whole number.";
      if (madInputToMinor(offer.totalMad) === null || madInputToMinor(offer.totalMad) === 0) next[`offers.${index}.totalMad`] = "Enter a MAD amount greater than zero.";
      if (offer.priority && !/^\d+$/u.test(offer.priority)) next[`offers.${index}.priority`] = "Enter a whole-number priority.";
      if (offer.startsAt && offer.endsAt && new Date(offer.startsAt) >= new Date(offer.endsAt)) next[`offers.${index}.endsAt`] = "End time must be after start time.";
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const mapError = (error: unknown) => {
    if (error instanceof SellerProductsServiceError) {
      const next = Object.fromEntries(error.fieldErrors.map((issue) => [issue.field, "Please review this field."]));
      setErrors(next);
    }
    toast.error(productErrorMessage(error));
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manager || !validate()) return;
    try {
      const saved = mode === "create"
        ? await (() => { const input = formToCreate(generatedId.current, form); return input ? create.mutateAsync(input) : Promise.reject(new Error("Invalid product form.")); })()
        : await (() => { const input = formToWrite(form); return input ? update.mutateAsync({ productId, input }) : Promise.reject(new Error("Invalid product form.")); })();
      setBaseline(productToForm(saved));
      toast.success(mode === "create" ? "Product created." : "Product saved.");
      router.replace(`/dashboard/products/${encodeURIComponent(saved.productId)}`);
    } catch (error) { mapError(error); }
  };

  return <form className="mx-auto w-full max-w-5xl space-y-5" onSubmit={save}>
    <header className="flex flex-col gap-3 rounded-xl border border-marketing-border bg-marketing-surface p-5 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Commerce operations</p><h2 className="mt-2 text-2xl font-semibold">{mode === "create" ? "Add product" : "Product details"}</h2><p className="mt-2 text-sm text-muted-foreground">{readOnly ? "You can review product information, but only workspace managers can change it." : "Changes replace the editable product details as one complete update."}</p></div>
      {!readOnly ? <div className="flex gap-2"><Button type="button" variant="outline" disabled={!dirty || mutationPending} onClick={() => { setForm(baseline); setErrors({}); }}>Discard</Button><Button disabled={mutationPending} type="submit">{mutationPending ? <Loader2 className="animate-spin" /> : null}Save product</Button></div> : null}
    </header>
    <Card><CardHeader><CardTitle>Product information</CardTitle><CardDescription>Prices use Moroccan dirhams (MAD). Images are managed separately and are shown below when present.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="product-name">Name</Label><Input id="product-name" disabled={readOnly} aria-invalid={Boolean(fieldError(errors, "name"))} value={form.name} onChange={(event) => setValue("name", event.target.value)} />{fieldError(errors, "name") ? <p className="text-sm text-destructive">{fieldError(errors, "name")}</p> : null}</div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="product-description">Description</Label><Textarea id="product-description" disabled={readOnly} value={form.description} onChange={(event) => setValue("description", event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="product-price">Price (MAD)</Label><Input id="product-price" inputMode="decimal" placeholder="0.00" disabled={readOnly} aria-invalid={Boolean(fieldError(errors, "price"))} value={form.priceMad} onChange={(event) => setValue("priceMad", event.target.value)} />{fieldError(errors, "price") ? <p className="text-sm text-destructive">{fieldError(errors, "price")}</p> : null}</div>
      <div className="space-y-2"><Label htmlFor="product-availability">Availability</Label><select id="product-availability" className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" disabled={readOnly} value={form.availability} onChange={(event) => setValue("availability", event.target.value as ProductFormState["availability"])}><option value="available">Available</option><option value="unavailable">Unavailable</option></select></div>
    </CardContent></Card>
    <OptionsSection errors={errors} options={form.options} readOnly={readOnly} onChange={(options) => setValue("options", options)} />
    <AliasesSection aliases={form.aliases} errors={errors} readOnly={readOnly} onChange={(aliases) => setValue("aliases", aliases)} />
    <OffersSection errors={errors} offers={form.offers} readOnly={readOnly} onChange={(offers) => setValue("offers", offers)} />
    {mode === "edit" && detail.data?.images.length ? <Card><CardHeader><CardTitle>Images</CardTitle><CardDescription>Image upload and delivery are not available in this phase.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">{detail.data.images.length} image{detail.data.images.length === 1 ? "" : "s"} currently attached.</p></CardContent></Card> : null}
    {!readOnly ? <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={!dirty || mutationPending} onClick={() => { setForm(baseline); setErrors({}); }}>Discard</Button><Button disabled={mutationPending} type="submit">{mutationPending ? <Loader2 className="animate-spin" /> : null}Save product</Button></div> : null}
  </form>;
}

function OptionsSection({ options, errors, readOnly, onChange }: Readonly<{ options: ProductOptionForm[]; errors: FormErrors; readOnly: boolean; onChange: (options: ProductOptionForm[]) => void }>) {
  const patch = (index: number, value: Partial<ProductOptionForm>) => onChange(options.map((option, current) => current === index ? { ...option, ...value } : option));
  return <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Options</CardTitle><CardDescription>Add choices such as size or color. Values retain their own availability.</CardDescription></div>{!readOnly ? <Button type="button" variant="outline" onClick={() => onChange([...options, { optionId: newId(), label: "", required: false, values: [] }])}><Plus />Add option</Button> : null}</CardHeader><CardContent className="space-y-4">{options.length === 0 ? <p className="text-sm text-muted-foreground">No options configured.</p> : options.map((option, index) => <div className="space-y-3 rounded-lg border p-4" key={option.optionId}><div className="flex flex-col gap-3 sm:flex-row"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`option-${option.optionId}`}>Option label</Label><Input id={`option-${option.optionId}`} disabled={readOnly} aria-invalid={Boolean(fieldError(errors, `options.${index}.label`))} value={option.label} onChange={(event) => patch(index, { label: event.target.value })} />{fieldError(errors, `options.${index}.label`) ? <p className="text-sm text-destructive">{fieldError(errors, `options.${index}.label`)}</p> : null}</div><label className="flex items-center gap-2 text-sm sm:pt-7"><Switch checked={option.required} disabled={readOnly} onCheckedChange={(required) => patch(index, { required })} />Required</label>{!readOnly ? <div className="flex gap-1 sm:pt-6"><Button aria-label="Move option up" disabled={index === 0} onClick={() => onChange(move(options, index, -1))} size="icon" type="button" variant="outline"><ArrowUp /></Button><Button aria-label="Move option down" disabled={index === options.length - 1} onClick={() => onChange(move(options, index, 1))} size="icon" type="button" variant="outline"><ArrowDown /></Button><Button aria-label="Remove option" onClick={() => onChange(options.filter((_, current) => current !== index))} size="icon" type="button" variant="outline"><Trash2 /></Button></div> : null}</div><div className="space-y-2"><p className="text-sm font-medium">Values</p>{option.values.map((value, valueIndex) => <div className="space-y-1" key={value.valueId}><div className="flex gap-2"><Input disabled={readOnly} aria-invalid={Boolean(fieldError(errors, `options.${index}.values.${valueIndex}.label`))} aria-label={`Value ${valueIndex + 1}`} value={value.label} onChange={(event) => patch(index, { values: option.values.map((current, itemIndex) => itemIndex === valueIndex ? { ...current, label: event.target.value } : current) })} /><label className="flex items-center gap-2 whitespace-nowrap text-sm"><Switch checked={value.isAvailable} disabled={readOnly} onCheckedChange={(isAvailable) => patch(index, { values: option.values.map((current, itemIndex) => itemIndex === valueIndex ? { ...current, isAvailable } : current) })} />Available</label>{!readOnly ? <><Button aria-label="Move value up" disabled={valueIndex === 0} onClick={() => patch(index, { values: move(option.values, valueIndex, -1) })} size="icon" type="button" variant="outline"><ArrowUp /></Button><Button aria-label="Move value down" disabled={valueIndex === option.values.length - 1} onClick={() => patch(index, { values: move(option.values, valueIndex, 1) })} size="icon" type="button" variant="outline"><ArrowDown /></Button><Button aria-label="Remove value" onClick={() => patch(index, { values: option.values.filter((_, itemIndex) => itemIndex !== valueIndex) })} size="icon" type="button" variant="outline"><Trash2 /></Button></> : null}</div>{fieldError(errors, `options.${index}.values.${valueIndex}.label`) ? <p className="text-sm text-destructive">{fieldError(errors, `options.${index}.values.${valueIndex}.label`)}</p> : null}</div>)}{fieldError(errors, `options.${index}.values`) ? <p className="text-sm text-destructive">{fieldError(errors, `options.${index}.values`)}</p> : null}{!readOnly ? <Button type="button" variant="outline" onClick={() => patch(index, { values: [...option.values, { valueId: newId(), label: "", isAvailable: true }] })}><Plus />Add value</Button> : null}</div></div>)}</CardContent></Card>;
}

function AliasesSection({ aliases, errors, readOnly, onChange }: Readonly<{ aliases: string[]; errors: FormErrors; readOnly: boolean; onChange: (aliases: string[]) => void }>) {
  return <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Aliases</CardTitle><CardDescription>Alternative names customers may use for this product.</CardDescription></div>{!readOnly ? <Button type="button" variant="outline" onClick={() => onChange([...aliases, ""])}><Plus />Add alias</Button> : null}</CardHeader><CardContent className="space-y-2">{aliases.length === 0 ? <p className="text-sm text-muted-foreground">No aliases configured.</p> : aliases.map((alias, index) => <div className="space-y-1" key={`${index}-${alias}`}><div className="flex gap-2"><Input disabled={readOnly} aria-invalid={Boolean(fieldError(errors, `aliases.${index}`))} aria-label={`Alias ${index + 1}`} value={alias} onChange={(event) => onChange(aliases.map((current, itemIndex) => itemIndex === index ? event.target.value : current))} />{!readOnly ? <Button aria-label="Remove alias" onClick={() => onChange(aliases.filter((_, itemIndex) => itemIndex !== index))} size="icon" type="button" variant="outline"><Trash2 /></Button> : null}</div>{fieldError(errors, `aliases.${index}`) ? <p className="text-sm text-destructive">{fieldError(errors, `aliases.${index}`)}</p> : null}</div>)}{fieldError(errors, "aliases") ? <p className="text-sm text-destructive">{fieldError(errors, "aliases")}</p> : null}</CardContent></Card>;
}

function OffersSection({ offers, errors, readOnly, onChange }: Readonly<{ offers: ProductOfferForm[]; errors: FormErrors; readOnly: boolean; onChange: (offers: ProductOfferForm[]) => void }>) {
  const patch = (index: number, value: Partial<ProductOfferForm>) => onChange(offers.map((offer, current) => current === index ? { ...offer, ...value } : offer));
  return <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Fixed-bundle offers</CardTitle><CardDescription>Set a fixed item count and total price for this product.</CardDescription></div>{!readOnly ? <Button type="button" variant="outline" onClick={() => onChange([...offers, { offerId: newId(), label: "", requiredItemCount: "2", totalMad: "", active: true, allowMixedOptions: false, priority: "0", startsAt: "", endsAt: "" }])}><Plus />Add offer</Button> : null}</CardHeader><CardContent className="space-y-4">{offers.length === 0 ? <p className="text-sm text-muted-foreground">No bundle offers configured.</p> : offers.map((offer, index) => <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2" key={offer.offerId}><div className="space-y-2"><Label>Offer label</Label><Input disabled={readOnly} aria-invalid={Boolean(fieldError(errors, `offers.${index}.label`))} value={offer.label} onChange={(event) => patch(index, { label: event.target.value })} />{fieldError(errors, `offers.${index}.label`) ? <p className="text-sm text-destructive">{fieldError(errors, `offers.${index}.label`)}</p> : null}</div><div className="space-y-2"><Label>Required item count</Label><Input disabled={readOnly} inputMode="numeric" aria-invalid={Boolean(fieldError(errors, `offers.${index}.requiredItemCount`))} value={offer.requiredItemCount} onChange={(event) => patch(index, { requiredItemCount: event.target.value })} />{fieldError(errors, `offers.${index}.requiredItemCount`) ? <p className="text-sm text-destructive">{fieldError(errors, `offers.${index}.requiredItemCount`)}</p> : null}</div><div className="space-y-2"><Label>Total price (MAD)</Label><Input disabled={readOnly} inputMode="decimal" aria-invalid={Boolean(fieldError(errors, `offers.${index}.totalMad`))} value={offer.totalMad} onChange={(event) => patch(index, { totalMad: event.target.value })} />{fieldError(errors, `offers.${index}.totalMad`) ? <p className="text-sm text-destructive">{fieldError(errors, `offers.${index}.totalMad`)}</p> : null}</div><div className="space-y-2"><Label>Priority</Label><Input disabled={readOnly} inputMode="numeric" value={offer.priority} onChange={(event) => patch(index, { priority: event.target.value })} /></div><div className="space-y-2"><Label>Starts at (optional)</Label><Input disabled={readOnly} type="datetime-local" value={localDateValue(offer.startsAt)} onChange={(event) => patch(index, { startsAt: event.target.value })} /></div><div className="space-y-2"><Label>Ends at (optional)</Label><Input disabled={readOnly} type="datetime-local" value={localDateValue(offer.endsAt)} onChange={(event) => patch(index, { endsAt: event.target.value })} />{fieldError(errors, `offers.${index}.endsAt`) ? <p className="text-sm text-destructive">{fieldError(errors, `offers.${index}.endsAt`)}</p> : null}</div><label className="flex items-center gap-2 text-sm"><Switch checked={offer.active} disabled={readOnly} onCheckedChange={(active) => patch(index, { active })} />Active</label><label className="flex items-center gap-2 text-sm"><Switch checked={offer.allowMixedOptions} disabled={readOnly} onCheckedChange={(allowMixedOptions) => patch(index, { allowMixedOptions })} />Allow mixed options</label>{!readOnly ? <div className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => onChange(offers.filter((_, current) => current !== index))}><Trash2 />Remove offer</Button></div> : null}</div>)}</CardContent></Card>;
}
