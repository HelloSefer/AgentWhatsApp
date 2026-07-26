"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { httpAuthService } from "../services/auth-service";
import { authErrorMessage } from "../utils/auth-error-message";
import type {
  AuthSession,
  EmailVerificationConfirmInput,
  EmailVerificationRequestInput,
  LoginInput,
  PasswordForgotInput,
  PasswordResetInput,
  SignupInput,
} from "../types/auth-contracts";

export const authQueryKeys = {
  session: ["auth", "session"] as const,
};

function clearPrivateAuthState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.setQueryData(authQueryKeys.session, null);
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] === "auth" && query.queryKey !== authQueryKeys.session,
  });
}

export function useAuthSession() {
  const sessionQuery = useQuery({
    queryKey: authQueryKeys.session,
    queryFn: () => httpAuthService.currentUser(),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    session: sessionQuery.data ?? null,
    user: sessionQuery.data?.user ?? null,
    memberships: sessionQuery.data?.memberships ?? [],
    needsOnboarding: sessionQuery.data?.needsOnboarding ?? false,
    isAuthenticated: Boolean(sessionQuery.data?.user),
    isLoading: sessionQuery.isLoading,
    isUnauthenticated: !sessionQuery.isLoading && sessionQuery.data === null,
    error: sessionQuery.error,
  };
}

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginInput) => httpAuthService.login(input),
    onSuccess: (session: AuthSession) => {
      queryClient.setQueryData(authQueryKeys.session, session);
    },
  });
}

export function useSignupMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SignupInput) => httpAuthService.signup(input),
    onSuccess: (session: AuthSession) => {
      queryClient.setQueryData(authQueryKeys.session, session);
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => httpAuthService.logout(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: authQueryKeys.session });
      clearPrivateAuthState(queryClient);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: authQueryKeys.session });
      router.replace("/login");
    },
    onError: (error) => {
      clearPrivateAuthState(queryClient);
      toast.error(authErrorMessage(error));
    },
  });
}

export function useRequestEmailVerificationMutation() {
  return useMutation({
    mutationFn: (input: EmailVerificationRequestInput) => httpAuthService.requestEmailVerification(input),
  });
}

export function useConfirmEmailVerificationMutation() {
  return useMutation({
    mutationFn: (input: EmailVerificationConfirmInput) => httpAuthService.confirmEmailVerification(input),
  });
}

export function useRequestPasswordResetMutation() {
  return useMutation({
    mutationFn: (input: PasswordForgotInput) => httpAuthService.requestPasswordReset(input),
  });
}

export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: (input: PasswordResetInput) => httpAuthService.resetPassword(input),
  });
}
