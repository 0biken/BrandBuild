"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";

type Plan = {
  name: string;
  price: (yearly: boolean) => string;
  unit: (yearly: boolean) => string;
  blurb?: string;
  cta: string;
  href: string;
  features: string[];
  featured?: boolean;
};

// Prices and limits are open decisions (design/DESIGN.md); placeholders stay
// until they are decided.
const PLANS: Plan[] = [
  {
    name: "Student",
    price: () => "Free",
    unit: () => "until [END DATE], with a verified school email",
    cta: "Verify and start",
    href: "/signup",
    features: [
      "[N] AI posts a month",
      "[N] connected accounts",
      "One brand voice",
      "Weekly insights",
    ],
  },
  {
    name: "Creator",
    price: (y) => (y ? "₦[YEARLY]" : "₦[PRICE]"),
    unit: (y) => (y ? "per year" : "per month"),
    blurb: "Most picked",
    cta: "Start Creator",
    href: "/signup",
    featured: true,
    features: [
      "Unlimited AI posts",
      "[N] connected accounts",
      "Full analytics and export",
      "Graphic maker",
    ],
  },
  {
    name: "Business",
    price: (y) => (y ? "₦[YEARLY]" : "₦[PRICE]"),
    unit: (y) => (y ? "per year" : "per month"),
    cta: "Start Business",
    href: "/signup",
    features: [
      "Everything in Creator",
      "[N] brands",
      "[N] team seats",
      "Approval before posting",
    ],
  },
];

export function PricingPlans() {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="flex flex-col gap-12">
      <div
        role="group"
        aria-label="Billing period"
        className="flex w-fit items-center gap-1 rounded-full border border-line bg-surface p-1"
      >
        <button
          type="button"
          aria-pressed={!yearly}
          onClick={() => setYearly(false)}
          className={`press min-h-11 cursor-pointer rounded-full border-0 px-5 text-[15px] font-semibold ${
            !yearly ? "bg-ink text-white" : "bg-transparent text-ink-2"
          }`}
        >
          Monthly
        </button>
        <button
          type="button"
          aria-pressed={yearly}
          onClick={() => setYearly(true)}
          className={`press flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-0 px-5 text-[15px] font-semibold ${
            yearly ? "bg-ink text-white" : "bg-transparent text-ink-2"
          }`}
        >
          Yearly
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              yearly ? "bg-lime text-forest" : "bg-primary-soft text-primary-ink"
            }`}
          >
            [N]% off
          </span>
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <article
            key={p.name}
            className={`flex flex-col gap-8 rounded-[28px] p-8 md:p-9 ${
              p.featured
                ? "bg-forest text-forest-text shadow-[0_40px_80px_-40px_rgba(15,42,27,0.7)]"
                : "border border-line bg-surface"
            }`}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2
                  className={`m-0 font-sans text-xl font-semibold tracking-[-0.02em] ${
                    p.featured ? "text-white" : ""
                  }`}
                >
                  {p.name}
                </h2>
                {p.blurb && (
                  <span className="rounded-full bg-lime px-3 py-1 text-sm font-semibold text-forest">
                    {p.blurb}
                  </span>
                )}
              </div>
              <p
                className={`m-0 font-sans text-[clamp(2.5rem,4vw,3.5rem)] leading-none font-semibold tracking-[-0.045em] ${
                  p.featured ? "text-white" : ""
                }`}
              >
                {p.price(yearly)}
              </p>
              <p className={`m-0 text-sm ${p.featured ? "text-forest-ink" : "text-muted"}`}>
                {p.unit(yearly)}
              </p>
            </div>

            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
                      p.featured ? "bg-lime text-forest" : "bg-primary-soft text-primary-ink"
                    }`}
                  >
                    <CheckIcon size={12} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <ButtonLink
              href={p.href}
              size="lg"
              variant={p.featured ? "lime" : "dark"}
              block
              className="mt-auto rounded-full"
            >
              {p.cta}
            </ButtonLink>
          </article>
        ))}
      </div>
    </div>
  );
}
