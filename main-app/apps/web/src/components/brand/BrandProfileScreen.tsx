"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { SparkIcon } from "@/components/ui/icons";
import { getBrand, updateBrand } from "@/lib/api/brand";
import { invalidate, useQuery } from "@/lib/api/hooks";
import type { Brand, BrandProfile } from "@/lib/api/types";
import { DEFAULT_FONTS, fontStack, loadBrandFonts } from "@/lib/brandKit";
import { TONES } from "@/lib/tones";
import { BrandFields } from "./BrandFields";
import { BrandKitFields } from "./BrandKitFields";

const toProfile = ({
  name,
  sells,
  audience,
  tones,
  wordsUse,
  wordsAvoid,
  color,
  palette,
  logo,
  fonts,
  samples,
}: Brand): BrandProfile => ({
  name,
  sells,
  audience,
  tones,
  wordsUse,
  wordsAvoid,
  color,
  palette: palette ?? [],
  logo,
  fonts: fonts ?? DEFAULT_FONTS,
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
        <Alert tone="error">We couldn&apos;t load your brand kit. Refresh to try again.</Alert>
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
          Brand kit
        </h1>
        <p className="m-0 text-[16px] leading-relaxed text-ink-2">
          Your logo, colours, fonts and voice. Every post Brandbuild writes uses these. Changes apply to new posts, not ones already drafted.
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
  const fonts = form.fonts ?? DEFAULT_FONTS;
  const swatches = [form.color, ...(form.palette ?? [])];

  useEffect(() => loadBrandFonts([fonts.heading, fonts.body]), [fonts.heading, fonts.body]);

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
      setError("We couldn't save your brand kit. Try again.");
      return;
    }
    toast({ tone: "success", message: "Brand kit saved." });
    invalidate("brand");
  }

  return (
    <Shell>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form onSubmit={save} noValidate className="flex min-w-0 flex-col gap-6">
          <BrandKitFields form={form} onChange={setForm} />

          <section id="voice" aria-labelledby="voice-title" className="flex scroll-mt-6 flex-col gap-6 border-t border-line pt-7">
            <h2 id="voice-title" className="m-0 font-display text-xl font-bold tracking-[-0.02em]">
              Voice and tone
            </h2>
            <BrandFields form={form} onChange={setForm} showColors={false} />
          </section>

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
            How you&apos;ll look and sound
          </span>
          <div aria-live="polite" className="overflow-hidden rounded-[16px] bg-white text-ink">
            <div className="flex items-center gap-2.5 p-3.5">
              {form.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL, not optimisable
                <img src={form.logo} alt="" className="size-9 rounded-full object-contain shadow-[inset_0_0_0_1px_var(--color-line)]" />
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-flex size-9 items-center justify-center rounded-full font-display font-bold text-white"
                  style={{ background: form.color }}
                >
                  {(form.name || "N").charAt(0)}
                </span>
              )}
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{form.name || "Your brand"}</span>
                <span className="text-xs text-muted">Sample post · {form.tones.join(" + ").toLowerCase()}</span>
              </span>
            </div>
            <div
              className="flex aspect-[4/3] flex-col justify-end gap-1 p-4"
              style={{ background: form.color, color: swatches[2] ?? "#FFFFFF" }}
            >
              <span className="text-[22px] leading-tight font-bold" style={{ fontFamily: fontStack(fonts.heading) }}>
                The new drop is here
              </span>
              <span
                className="self-start rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ background: swatches[1] ?? "#FFFFFF", color: form.color, fontFamily: fontStack(fonts.body) }}
              >
                Shop Friday 7 PM
              </span>
            </div>
            <p className="m-0 p-3.5 text-sm leading-relaxed" style={{ fontFamily: fontStack(fonts.body) }}>
              {lead.sample}
            </p>
          </div>
          <div className="flex gap-1.5" role="img" aria-label={`Your colours: ${swatches.join(", ")}`}>
            {swatches.map((c, i) => (
              <span key={i} title={c} className="h-6 flex-1 rounded-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]" style={{ background: c }} />
            ))}
          </div>
          <span className="text-[13px] text-forest-ink">Change the colours, fonts or tone and this updates.</span>
        </aside>
      </div>
    </Shell>
  );
}
