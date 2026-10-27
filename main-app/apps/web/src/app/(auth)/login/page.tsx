import type { Metadata } from "next";
import { SplitShell } from "@/components/auth/AuthShell";
import { LogInForm } from "@/components/auth/LogInForm";

export const metadata: Metadata = { title: "Log in" };

export default function LogInPage() {
  return (
    <SplitShell
      aside={
        <div className="mx-auto flex w-full max-w-[380px] flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.08em] text-lime uppercase">
            While you were away
          </span>
          <div className="flex flex-col gap-2.5 rounded-[20px] bg-white p-[18px] text-ink">
            <span className="flex items-center gap-2 text-sm text-muted">
              <span className="size-2 rounded-full bg-primary" />
              Published &middot; Friday 7:00 PM
            </span>
            <span className="text-[17px] font-semibold">Drop is live &mdash; link in bio</span>
            <span className="font-display text-[34px] font-bold tracking-[-0.03em]">
              [N]{" "}
              <span className="font-sans text-[15px] font-medium tracking-normal text-muted">
                engagements so far
              </span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[20px] bg-forest-2 px-[18px] py-4">
            <span className="text-[15px] font-semibold text-white">
              3 posts scheduled this week
            </span>
            <span className="text-sm text-forest-ink">Next: Shade lineup, Wed 12:30 PM</span>
          </div>
        </div>
      }
    >
      <LogInForm />
    </SplitShell>
  );
}
