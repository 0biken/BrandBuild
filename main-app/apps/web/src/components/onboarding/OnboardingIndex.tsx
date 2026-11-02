"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { getOnboarding, nextStepPath } from "@/lib/api/onboarding";
import { ROUTES } from "@/lib/routes";

/** /app/onboarding: resume at the first unfinished step, or go Home. */
export function OnboardingIndex() {
  const router = useRouter();
  useEffect(() => {
    getOnboarding().then((res) => {
      router.replace((res.ok && nextStepPath(res.data)) || ROUTES.home);
    });
  }, [router]);
  return (
    <div className="mx-auto max-w-xl p-10" aria-busy="true">
      <Skeleton className="h-40 rounded-[20px]" />
    </div>
  );
}
