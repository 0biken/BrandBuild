"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink, buttonStyles } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckIcon, DraftsIcon } from "@/components/ui/icons";
import { getBrand } from "@/lib/api/brand";
import { useQuery } from "@/lib/api/hooks";
import type { Brand } from "@/lib/api/types";

const SUPPORT = "mailto:hello@brandbuild.co?subject=Billing";

const PLAN_COPY: Record<Brand["plan"], { name: string; perks: string[] }> = {
  student: {
    name: "Student",
    perks: ["AI post ideas and captions", "Scheduling to your connected accounts", "Weekly insights"],
  },
  creator: {
    name: "Creator",
    perks: ["Unlimited AI posts", "Full analytics and export", "Graphic maker"],
  },
  business: {
    name: "Business",
    perks: ["Everything in Creator", "Several brands and team seats", "Approval before posting"],
  },
};

/**
 * Billing shell. The payments provider is still an open decision (TASKS.md
 * section C), and its hosted portal will handle cards and invoices, so this
 * shows the current plan and links out instead of collecting anything.
 */
export function BillingScreen() {
  const brand = useQuery("brand", getBrand);
  const plan = brand.data ? PLAN_COPY[brand.data.plan] : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-7">
      <h1 className="m-0 font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
        Plan and billing
      </h1>

      <section aria-labelledby="current-plan" className="flex flex-col gap-3">
        <h2 id="current-plan" className="m-0 font-display text-xl font-bold tracking-[-0.02em]">
          Your plan
        </h2>
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          {brand.data && plan ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-2xl font-bold tracking-[-0.02em]">{plan.name}</span>
                <span className="text-sm font-semibold text-primary-ink">
                  {brand.data.plan === "student" ? `Free until ${brand.data.planEndsLabel}` : "Active"}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex items-center gap-2 text-[15px] text-ink-2">
                    <CheckIcon size={16} className="shrink-0 text-primary-ink" />
                    {perk}
                  </li>
                ))}
              </ul>
            </>
          ) : brand.error ? (
            <p className="m-0 text-[15px] text-muted">We couldn&apos;t load your plan. Refresh to try again.</p>
          ) : (
            <Skeleton className="h-28 w-full" />
          )}
        </div>
      </section>

      <Alert tone="info">
        Paid plans open at launch. We&apos;ll email you before any free access ends, and nothing is charged
        until you choose a plan.
      </Alert>

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/pricing">Compare plans</ButtonLink>
        <a href={SUPPORT} className={buttonStyles({ variant: "outline" })}>
          Talk to us about billing
        </a>
      </div>

      <section aria-labelledby="invoices" className="flex flex-col gap-3">
        <h2 id="invoices" className="m-0 font-display text-xl font-bold tracking-[-0.02em]">
          Invoices
        </h2>
        <EmptyState
          icon={DraftsIcon}
          title="No invoices yet"
          body={
            <>
              Receipts appear here once you&apos;re on a paid plan. See <Link href="/legal" className="underline">our terms</Link>{" "}
              for how billing will work.
            </>
          }
        />
      </section>
    </div>
  );
}
