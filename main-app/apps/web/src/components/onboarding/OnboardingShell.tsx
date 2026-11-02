"use client";

import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { CheckIcon } from "@/components/ui/icons";
import { useQuery } from "@/lib/api/hooks";
import { ONBOARDING_STEPS, getOnboarding, type OnboardingStep } from "@/lib/api/onboarding";
import { ROUTES } from "@/lib/routes";

const RAIL = [{ id: "account" as const, label: "Your account" }, ...ONBOARDING_STEPS];

/**
 * Onboarding layout (Verify, Connect, BrandSetup designs): forest panel on
 * the left with the 4-step rail and a step-specific panel, form on the right.
 * The panel is hidden below 860px; the rail collapses to a progress line.
 */
export function OnboardingShell({
  step,
  title,
  intro,
  panel,
  children,
}: {
  step: OnboardingStep;
  title: string;
  intro: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  const onboarding = useQuery("onboarding", getOnboarding);
  const current = RAIL.findIndex((s) => s.id === step);

  const statusOf = (id: (typeof RAIL)[number]["id"], i: number) => {
    if (id === "account") return "done";
    if (i === current) return "current";
    return onboarding.data?.[id] ?? "todo";
  };

  return (
    <div className="flex min-h-screen w-full bg-page">
      <aside className="flex w-[460px] shrink-0 flex-col gap-10 bg-forest p-12 text-forest-text max-lg:w-[380px] max-lg:p-9 max-md:hidden">
        <Logo tone="light" href={ROUTES.home} />
        <ol aria-label="Setup steps" className="m-0 flex list-none flex-col gap-3 p-0">
          {RAIL.map((s, i) => {
            const st = statusOf(s.id, i);
            const done = st === "done" || st === "skipped";
            return (
              <li
                key={s.id}
                aria-current={st === "current" ? "step" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] ${
                  st === "current" ? "bg-white font-semibold text-ink" : done ? "text-white" : "text-forest-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold ${
                    done
                      ? "bg-lime text-forest"
                      : st === "current"
                        ? "bg-primary-strong text-white"
                        : "shadow-[inset_0_0_0_1.5px_var(--color-forest-line)]"
                  }`}
                >
                  {done ? <CheckIcon size={14} /> : i + 1}
                </span>
                {s.label}
                <span className="sr-only">
                  , {st === "current" ? "current" : st === "skipped" ? "skipped" : done ? "done" : "not started"}
                </span>
              </li>
            );
          })}
        </ol>
        {panel && <div className="mt-auto flex flex-col gap-4">{panel}</div>}
      </aside>

      <main id="app-main" className="flex min-w-0 flex-1 justify-center px-14 py-12 max-md:px-4 max-md:py-6">
        <div className="flex w-full max-w-[560px] flex-col gap-7">
          <div className="hidden max-md:flex max-md:flex-col max-md:gap-5">
            <Logo href={ROUTES.home} />
            <div aria-hidden="true" className="flex gap-1.5">
              {RAIL.map((s, i) => (
                <span key={s.id} className={`h-1 flex-1 rounded-full ${i <= current ? "bg-primary" : "bg-line"}`} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-primary-hover">
              Step {current + 1} of {RAIL.length}
            </span>
            <h1 className="m-0 font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
              {title}
            </h1>
            <p className="m-0 text-[16px] leading-relaxed text-ink-2">{intro}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Primary action + skip link row at the bottom of each step. */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-4 pt-2">{children}</div>;
}
