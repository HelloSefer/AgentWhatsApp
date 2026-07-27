import { OnboardingServiceError } from "../services/onboarding-service";

export function onboardingErrorMessage(error: unknown): string {
  if (error instanceof OnboardingServiceError) return error.message;
  return "Something went wrong while setting up your workspace. Please try again.";
}
