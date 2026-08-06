"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { whatsappConnectionQueryKey } from "../components/customer-owned-meta-app-wizard";
import { whatsappProductBindingService } from "../services/whatsapp-product-binding-service";
export const whatsappProductBindingKeys = { all: ["whatsapp-product-binding"] as const, detail: (connectionId: string) => ["whatsapp-product-binding", connectionId] as const };
export function useWhatsappProductBinding(connectionId: string) { return useQuery({ queryKey: whatsappProductBindingKeys.detail(connectionId), queryFn: () => whatsappProductBindingService.getProductBinding(connectionId), enabled: Boolean(connectionId), retry: false, refetchOnWindowFocus: false }); }
function useBindingRefresh(connectionId: string) { const client = useQueryClient(); return async (value: Awaited<ReturnType<typeof whatsappProductBindingService.getProductBinding>>) => { client.setQueryData(whatsappProductBindingKeys.detail(connectionId), value); await client.invalidateQueries({ queryKey: whatsappConnectionQueryKey }); }; }
export function useBindWhatsappProduct(connectionId: string) { const refresh = useBindingRefresh(connectionId); return useMutation({ mutationFn: (productId: string) => whatsappProductBindingService.bindProduct(connectionId, productId), onSuccess: refresh }); }
export function useClearWhatsappProductBinding(connectionId: string) { const refresh = useBindingRefresh(connectionId); return useMutation({ mutationFn: () => whatsappProductBindingService.clearProductBinding(connectionId), onSuccess: refresh }); }
