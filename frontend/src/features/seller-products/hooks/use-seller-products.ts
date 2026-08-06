"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sellerProductsService } from "../services/seller-products-service";
import type { SellerProductCreateInput, SellerProductWriteInput } from "../types/product-contracts";
export const sellerProductKeys = { all: ["seller-products"] as const, list: ["seller-products", "list"] as const, detail: (id: string) => ["seller-products", "detail", id] as const };
export function useSellerProducts() {
  return useInfiniteQuery({
    queryKey: sellerProductKeys.list,
    queryFn: ({ pageParam }) => sellerProductsService.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
export function useSellerProduct(productId: string) { return useQuery({ queryKey: sellerProductKeys.detail(productId), queryFn: () => sellerProductsService.get(productId), enabled: Boolean(productId), retry: false, refetchOnWindowFocus: false }); }
function useRefresh() { const client = useQueryClient(); return async (productId: string) => { await client.invalidateQueries({ queryKey: sellerProductKeys.list }); await client.invalidateQueries({ queryKey: sellerProductKeys.detail(productId) }); }; }
export function useCreateSellerProduct() { const refresh = useRefresh(); return useMutation({ mutationFn: (input: SellerProductCreateInput) => sellerProductsService.create(input), onSuccess: async (item) => refresh(item.productId) }); }
export function useUpdateSellerProduct() { const refresh = useRefresh(); return useMutation({ mutationFn: ({ productId, input }: { productId: string; input: SellerProductWriteInput }) => sellerProductsService.replace(productId, input), onSuccess: async (item) => refresh(item.productId) }); }
export function useUpdateProductAvailability() { const refresh = useRefresh(); return useMutation({ mutationFn: ({ productId, availability }: { productId: string; availability: "available" | "unavailable" }) => sellerProductsService.setAvailability(productId, availability), onSuccess: async (item) => refresh(item.productId) }); }
