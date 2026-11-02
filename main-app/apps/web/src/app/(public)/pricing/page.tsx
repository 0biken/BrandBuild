import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing/PricingPlans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple plans. Free for students.",
};

const NONE = "—";

// [feature, student, creator, business]; NONE means not included.
const ROWS: [string, string, string, string][] = [
  ["AI posts per month", "[N]", "Unlimited", "Unlimited"],
  ["Connected accounts", "[N]", "[N]", "[N]"],
  ["Brand voices", "1", "1", "[N]"],
  ["Analytics history", "[N] days", "[N] months", "[N] months"],
  ["Graphic maker", NONE, "Included", "Included"],
  ["Team seats and approvals", NONE, NONE, "Included"],
  ["Support", "Help centre", "Email", "Priority"],
];

export default function PricingPage() {
  return (
    <div className="px-6 pt-40 pb-32 md:px-12 md:pt-52 md:pb-48">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-16 md:gap-24">
        <header className="flex flex-col gap-6">
          <h1 className="m-0 max-w-5xl font-sans text-[clamp(2.4rem,6.2vw,5.75rem)] leading-[0.98] font-semibold tracking-[-0.045em]">
            Simple plans. Free for students.
          </h1>
          <p className="m-0 max-w-xl text-[19px] leading-relaxed text-ink-2">
            Every plan includes AI captions in your brand voice, per-platform
            previews and the calendar.
          </p>
        </header>

        <PricingPlans />

        <section aria-labelledby="compare" className="flex flex-col gap-8">
          <h2
            id="compare"
            className="m-0 font-sans text-[clamp(2rem,3.5vw,3rem)] leading-none font-semibold tracking-[-0.04em]"
          >
            Compare plans
          </h2>
          <div className="overflow-x-auto rounded-[28px] border border-line bg-surface">
            <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-6 py-4 font-semibold">Feature</th>
                  <th scope="col" className="px-6 py-4 font-semibold">Student</th>
                  <th scope="col" className="px-6 py-4 font-semibold">Creator</th>
                  <th scope="col" className="px-6 py-4 font-semibold">Business</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([feature, ...cells]) => (
                  <tr key={feature} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-6 py-4 font-medium">{feature}</th>
                    {cells.map((c, i) => (
                      <td key={i} className="px-6 py-4 text-ink-2">
                        {c === NONE ? (
                          <>
                            <span aria-hidden="true">{NONE}</span>
                            <span className="sr-only">Not included</span>
                          </>
                        ) : (
                          c
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-sm text-muted">
            Prices in naira. Pay with card or bank transfer. Cancel any time from Settings.
          </p>
        </section>
      </div>
    </div>
  );
}
