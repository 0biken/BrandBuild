"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";
import {
  PLANS,
  TRIAL_DAYS,
  YEARLY_LABEL,
  formatPrice,
  type Currency,
  type PlanSpec,
} from "@/lib/plans";

type Card = {
  plan: PlanSpec;
  blurb?: string;
  cta: string;
  href: string;
  features: string[];
  featured?: boolean;
};

const { student, creator, business } = PLANS;

const CARDS: Card[] = [
  {
    plan: student,
    cta: "Verify and start",
    href: "/signup",
    features: [
      `${student.aiPostsPerMonth} AI posts a month`,
      `${student.connectedAccounts} connected accounts`,
      "One brand voice",
      "Weekly insights",
    ],
  },
  {
    plan: creator,
    blurb: "Most picked",
    cta: `Start ${TRIAL_DAYS}-day free trial`,
    href: "/signup",
    featured: true,
    features: [
      "Unlimited AI posts",
      `${creator.connectedAccounts} connected accounts`,
      "Full analytics and export",
      "Graphic maker",
    ],
  },
  {
    plan: business,
    cta: "Start Business",
    href: "/signup",
    features: [
      "Everything in Creator",
      `${business.brands} brands`,
      `${business.seats} team seats`,
      "Approval before posting",
    ],
  },
];

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; badge?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit items-center gap-1 rounded-full border border-line bg-surface p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`press flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-0 px-5 text-[15px] font-semibold ${
              on ? "bg-ink text-white" : "bg-transparent text-ink-2"
            }`}
          >
            {o.label}
            {o.badge && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  on ? "bg-lime text-forest" : "bg-primary-soft text-primary-ink"
                }`}
              >
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PricingPlans() {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [currency, setCurrency] = useState<Currency>("NGN");
  const yearly = period === "yearly";

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          label="Billing period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly", badge: YEARLY_LABEL },
          ]}
        />
        <Toggle
          label="Currency"
          value={currency}
          onChange={setCurrency}
          options={[
            { value: "NGN", label: "₦ Naira" },
            { value: "USD", label: "$ USD" },
          ]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {CARDS.map(({ plan, blurb, cta, href, features, featured }) => {
          const price = plan.price?.[currency];
          return (
            <article
              key={plan.id}
              className={`flex flex-col gap-8 rounded-[28px] p-8 md:p-9 ${
                featured
                  ? "bg-forest text-forest-text shadow-[0_40px_80px_-40px_rgba(15,42,27,0.7)]"
                  : "border border-line bg-surface"
              }`}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    className={`m-0 font-sans text-xl font-semibold tracking-[-0.02em] ${
                      featured ? "text-white" : ""
                    }`}
                  >
                    {plan.name}
                  </h2>
                  {blurb && (
                    <span className="rounded-full bg-lime px-3 py-1 text-sm font-semibold text-forest">
                      {blurb}
                    </span>
                  )}
                </div>
                <p
                  className={`m-0 font-sans text-[clamp(2.1rem,4vw,3.5rem)] leading-none font-semibold tracking-[-0.045em] ${
                    featured ? "text-white" : ""
                  }`}
                >
                  {price ? formatPrice(yearly ? price.yearly : price.monthly, currency) : "Free"}
                </p>
                <p className={`m-0 text-sm ${featured ? "text-forest-ink" : "text-muted"}`}>
                  {price
                    ? yearly
                      ? "per year"
                      : "per month"
                    : "forever, with a verified school email"}
                </p>
              </div>

              <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
                        featured ? "bg-lime text-forest" : "bg-primary-soft text-primary-ink"
                      }`}
                    >
                      <CheckIcon size={12} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <ButtonLink
                href={href}
                size="lg"
                variant={featured ? "lime" : "dark"}
                block
                className="mt-auto rounded-full"
              >
                {cta}
              </ButtonLink>
            </article>
          );
        })}
      </div>

      <p className="m-0 text-sm text-muted">
        Not a student? Try Creator free for {TRIAL_DAYS} days, no card needed. After
        that, keep scheduling for free and write posts yourself, or pick a plan.
      </p>
    </div>
  );
}
