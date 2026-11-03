"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { SparkIcon } from "@/components/ui/icons";
import { getBrand, updateBrand } from "@/lib/api/brand";
import { invalidate, useQuery } from "@/lib/api/hooks";
import type { Brand, BrandProfile } from "@/lib/api/types";
import { TONES } from "@/lib/tones";
import { BRAND_COLORS, BrandFields } from "./BrandFields";

const toProfile = ({ name, sells, audience, tones, wordsUse, wordsAvoid, color, samples }: Brand): BrandProfile => ({
  name,
  sells,
  audience,
  tones,
  wordsUse,
  wordsAvoid,
  color,
  samples,
});

export function BrandProfileScreen() {
  const brand = useQuery("brand", getBrand);
  // Remount the form whenever the saved brand changes, so it starts from it.
  return brand.data ? (
    <BrandProfileForm key={JSON.stringify(toProfile(brand.data))} saved={toProfile(brand.data)} />
  ) : (
    <Shell>
      {brand.error ? (
        <Alert tone="error">We couldn&apos;t load your brand profile. Refresh to try again.</Alert>
      ) : (
        <Skeleton className="h-[560px] rounded-[20px]" />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
          Brand profile
        </h1>
        <p className="m-0 text-[16px] leading-relaxed text-ink-2">
          Every caption Brandbuild writes uses these settings. Changes apply to new posts, not ones already drafted.
        </p>
      </div>
      {children}
    </div>
  );
}

function BrandProfileForm({ saved }: { saved: BrandProfile }) {
  const toast = useToast();
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const lead = TONES.find((t) => t.label === form.tones.at(-1)) ?? TONES[0];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Add your brand name.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await updateBrand(form);
    setBusy(false);
    if (!res.ok) {
      setError("We couldn't save your brand profile. Try again.");
      return;
    }
    toast({ tone: "success", message: "Brand profile saved." });
    invalidate("brand");
  }

  return (
    <Shell>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form onSubmit={save} noValidate className="flex min-w-0 flex-col gap-6">
          <BrandFields form={form} onChange={setForm} />

          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Button type="submit" size="lg" disabled={busy || !dirty}>
              {busy ? "Saving..." : "Save changes"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !dirty}
              onClick={() => {
                setForm(saved);
                setError("");
              }}
            >
              Discard changes
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-3 rounded-[20px] bg-forest p-5 text-forest-text lg:sticky lg:top-6">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-lime uppercase">
            <SparkIcon size={15} />
            How you&apos;ll sound
          </span>
          <div aria-live="polite" className="overflow-hidden rounded-[16px] bg-white text-ink">
            <div className="flex items-center gap-2.5 p-3.5">
              <span
                aria-hidden="true"
                className="inline-flex size-9 items-center justify-center rounded-full font-display font-bold text-white"
                style={{ background: form.color || BRAND_COLORS[0] }}
              >
                {(form.name || "N").charAt(0)}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{form.name || "Your brand"}</span>
                <span className="text-xs text-muted">Sample post · {form.tones.join(" + ").toLowerCase()}</span>
              </span>
            </div>
            <p className="m-0 p-3.5 pt-0 text-sm leading-relaxed">{lead.sample}</p>
          </div>
          <span className="text-[13px] text-forest-ink">Change the tone and this rewrites itself.</span>
        </aside>
      </div>
    </Shell>
  );
}
