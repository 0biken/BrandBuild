// Single source for plan prices and limits shown in the app.
// These are launch hypotheses (docs/business/proposal.md) until customer
// interviews confirm them; change them here, not in components.
// Limits are display-only for now: the backend does not enforce them yet.

export type PlanId = "student" | "creator" | "business";
export type Currency = "NGN" | "USD";

type Price = { monthly: number; yearly: number };

export type PlanSpec = {
  id: PlanId;
  name: string;
  /** null = free */
  price: Record<Currency, Price> | null;
  aiPostsPerMonth: number | "unlimited";
  connectedAccounts: number;
  brands: number;
  seats: number;
  analyticsHistory: string;
};

/** Yearly = 10 × monthly ("2 months free", about 17% off). */
export const YEARLY_LABEL = "2 months free";
export const TRIAL_DAYS = 14;
export const STUDENT_REVERIFY = "every year";

export const PLANS: Record<PlanId, PlanSpec> = {
  student: {
    id: "student",
    name: "Student",
    price: null,
    aiPostsPerMonth: 15,
    connectedAccounts: 2,
    brands: 1,
    seats: 1,
    analyticsHistory: "30 days",
  },
  creator: {
    id: "creator",
    name: "Creator",
    price: {
      NGN: { monthly: 5_000, yearly: 50_000 },
      USD: { monthly: 9, yearly: 90 },
    },
    aiPostsPerMonth: "unlimited",
    connectedAccounts: 4,
    brands: 1,
    seats: 1,
    analyticsHistory: "12 months",
  },
  business: {
    id: "business",
    name: "Business",
    price: {
      NGN: { monthly: 15_000, yearly: 150_000 },
      USD: { monthly: 29, yearly: 290 },
    },
    aiPostsPerMonth: "unlimited",
    connectedAccounts: 12,
    brands: 3,
    seats: 3,
    analyticsHistory: "24 months",
  },
};

export function formatPrice(amount: number, currency: Currency): string {
  return currency === "NGN"
    ? `₦${amount.toLocaleString("en-NG")}`
    : `$${amount.toLocaleString("en-US")}`;
}

export function aiPostsLabel(p: PlanSpec): string {
  return p.aiPostsPerMonth === "unlimited" ? "Unlimited" : String(p.aiPostsPerMonth);
}

/** Student status line; students stay free and re-verify by the end date. */
export function studentStatusLabel(planEndsLabel: string): string {
  return planEndsLabel ? `Free · re-verify by ${planEndsLabel}` : "Free forever";
}
