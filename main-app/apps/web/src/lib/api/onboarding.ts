import { read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, OnboardingState, StepStatus } from "./types";

export type OnboardingStep = keyof OnboardingState;

/** Steps in order. Step 1 ("Your account") is done once you're signed in. */
export const ONBOARDING_STEPS: { id: OnboardingStep; label: string; path: string }[] = [
  { id: "verify", label: "Student check", path: "/app/onboarding/verify" },
  { id: "connect", label: "Connect accounts", path: "/app/onboarding/connect" },
  { id: "brand", label: "Brand voice", path: "/app/onboarding/brand" },
];

export async function getOnboarding(): Promise<ApiResult<OnboardingState>> {
  if (API_MODE === "http") return apiFetch<OnboardingState>("/v1/onboarding");
  return read((d) => d.onboarding);
}

export async function completeStep(step: OnboardingStep, status: Exclude<StepStatus, "todo">): Promise<ApiResult<OnboardingState>> {
  if (API_MODE === "http") {
    return apiFetch<OnboardingState>(`/v1/onboarding/${step}`, { method: "POST", body: { status } });
  }
  return write((d) => {
    d.onboarding[step] = status;
    return d.onboarding;
  });
}

/** Where to go next: the first unfinished step, or null when onboarding is complete. */
export function nextStepPath(state: OnboardingState): string | null {
  return ONBOARDING_STEPS.find((s) => state[s.id] === "todo")?.path ?? null;
}
