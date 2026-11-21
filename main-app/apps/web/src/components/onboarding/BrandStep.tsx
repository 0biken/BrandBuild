"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { BRAND_COLORS, BrandFields } from "@/components/brand/BrandFields";
import { Skeleton } from "@/components/ui/Skeleton";
import { SparkIcon } from "@/components/ui/icons";
import { getBrand, updateBrand } from "@/lib/api/brand";
import { invalidate } from "@/lib/api/hooks";
import type { BrandProfile } from "@/lib/api/types";
import { TONES } from "@/lib/tones";
import { OnboardingShell, StepActions } from "./OnboardingShell";
import { useOnboardingNav } from "./useOnboardingNav";

export function BrandStep() {
  const advance = useOnboardingNav();
  const [form, setForm] = useState<BrandProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getBrand().then((res) => {
      if (!live || !res.ok) return;
      const { name, sells, audience, tones, wordsUse, wordsAvoid, color, samples } = res.data;
      setForm({ name, sells, audience, tones, wordsUse, wordsAvoid, color, samples });
    });
    return () => {
      live = false;
    };
  }, []);

  async function finish(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) {
      setError("Add your brand name.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await updateBrand(form);
    if (!res.ok) {
      setBusy(false);
      setError("We couldn't save your brand voice. Try again.");
      return;
    }
    invalidate("brand");
    await advance("brand", "done");
  }

  async function later() {
    setBusy(true);
    await advance("brand", "skipped");
  }

  const lead = TONES.find((t) => t.label === form?.tones.at(-1)) ?? TONES[0];

  return (
    <OnboardingShell
      step="brand"
      title="Teach Brandbuild your voice"
      intro="So captions sound like you, not like everyone else. You can change all of this later."
      panel={
        <>
          <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-lime uppercase">
            <SparkIcon size={15} />
            How you&apos;ll sound
          </span>
          <div aria-live="polite" className="overflow-hidden rounded-[20px] bg-white text-ink shadow-[0_24px_48px_-24px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-2.5 p-3.5">
              <span
                aria-hidden="true"
                className="inline-flex size-9 items-center justify-center rounded-full font-display font-bold text-white"
                style={{ background: form?.color ?? BRAND_COLORS[0] }}
              >
                {(form?.name || "N").charAt(0)}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{form?.name || "Your brand"}</span>
                <span className="text-xs text-muted">Sample post · {form?.tones.join(" + ").toLowerCase()}</span>
              </span>
            </div>
            <div className="flex aspect-[4/3] items-center justify-center bg-[#DCE6DE] text-[13px] text-ink-2" aria-hidden="true">
              [PHOTO: product]
            </div>
            <p className="m-0 p-3.5 text-sm leading-relaxed">{lead.sample}</p>
          </div>
          <span className="text-[13px] text-forest-ink">
            Change the tone and this rewrites itself. Every caption Brandbuild writes uses these settings.
          </span>
        </>
      }
    >
      {!form ? (
        <Skeleton className="h-[560px] rounded-[20px]" />
      ) : (
        <form onSubmit={finish} noValidate className="flex flex-col gap-6">
          <BrandFields form={form} onChange={setForm} />

          {error && <Alert tone="error">{error}</Alert>}

          <StepActions>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Saving..." : "Finish setup"}
            </Button>
            <Button variant="ghost" onClick={later} disabled={busy}>
              Do this later
            </Button>
          </StepActions>
        </form>
      )}
    </OnboardingShell>
  );
}
