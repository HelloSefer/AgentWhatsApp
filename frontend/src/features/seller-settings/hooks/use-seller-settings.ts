"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpSellerSettingsService } from "../services/seller-settings-service";
import type { SellerSettingsUpdateInput } from "../types/seller-settings-contracts";

export const sellerSettingsQueryKeys = {
  settings: ["seller-settings", "settings"] as const,
};

export function useSellerSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: sellerSettingsQueryKeys.settings,
    queryFn: () => httpSellerSettingsService.read(),
    enabled,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateSellerSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SellerSettingsUpdateInput) => httpSellerSettingsService.update(input),
    onSuccess: async (settings) => {
      queryClient.setQueryData(sellerSettingsQueryKeys.settings, settings);
      await queryClient.invalidateQueries({ queryKey: sellerSettingsQueryKeys.settings });
    },
  });
}
