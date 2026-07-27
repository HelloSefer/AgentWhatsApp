"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpOnboardingService } from "../services/onboarding-service";
import type { CreateWorkspaceInput } from "../types/onboarding-contracts";

export const onboardingQueryKeys = {
  status: ["onboarding", "status"] as const,
};

export function useOnboardingStatus(enabled: boolean) {
  return useQuery({
    queryKey: onboardingQueryKeys.status,
    queryFn: () => httpOnboardingService.status(),
    enabled,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateWorkspaceMutation() {
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => httpOnboardingService.createWorkspace(input),
  });
}

export function useUploadLogoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => httpOnboardingService.uploadLogo(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: onboardingQueryKeys.status });
    },
  });
}

export function useRemoveLogoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => httpOnboardingService.removeLogo(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: onboardingQueryKeys.status });
    },
  });
}
