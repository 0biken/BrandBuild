"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { invalidate } from "@/lib/api/hooks";
import { completeStep, nextStepPath, type OnboardingStep } from "@/lib/api/onboarding";
import { ROUTES } from "@/lib/routes";

/** Mark a step done or skipped, then go to the next unfinished step (or Home). */
export function useOnboardingNav() {
  const router = useRouter();
  const toast = useToast();
  return async function advance(step: OnboardingStep, status: "done" | "skipped") {
    const res = await completeStep(step, status);
    invalidate("onboarding");
    if (!res.ok) {
      toast({ tone: "error", message: "We couldn't save your progress. Try again." });
      return false;
    }
    const next = nextStepPath(res.data);
    if (!next) toast({ tone: "success", message: "You're set up. Time to write your first post." });
    router.push(next ?? ROUTES.home);
    return true;
  };
}
