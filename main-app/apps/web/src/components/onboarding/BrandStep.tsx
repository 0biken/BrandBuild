"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/FormControls";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckIcon, SparkIcon } from "@/components/ui/icons";
import { getBrand, updateBrand } from "@/lib/api/brand";
import { invalidate } from "@/lib/api/hooks";
import type { BrandProfile, Tone } from "@/lib/api/types";
import { MAX_TONES, TONES, toggleTone } from "@/lib/tones";
import { OnboardingShell, StepActions } from "./OnboardingShell";
import { useOnboardingNav } from "./useOnboardingNav";

const AUDIENCES = ["Students", "Young professionals", "Gift buyers", "Gen Z", "Brides"];
const COLORS = ["#0F2A1B", "#D62976", "#F4C7B8"];

export function BrandStep() {
  const advance = useOnboardingNav();
  const [form, setForm] = useState<BrandProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toneNote, setToneNote] = useState("");

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

  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  function pickTone(t: Tone) {
    if (!form) return;
    const next = toggleTone(form.tones, t);
    if (next === form.tones) setToneNote("Keep at least one tone.");
    else if (!form.tones.includes(t) && form.tones.length >= MAX_TONES)
      setToneNote(`Up to ${MAX_TONES} tones. ${form.tones[0]} was swapped for ${t}.`);
    else setToneNote("");
    set("tones", next);
  }

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
                style={{ background: form?.color ?? COLORS[0] }}
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
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="brand-name" label="Brand name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            <Field id="brand-sells" label="What you sell" value={form.sells} onChange={(e) => set("sells", e.target.value)} />
          </div>

          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 text-sm font-semibold">Who it&apos;s for</legend>
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map((a) => {
                const on = form.audience.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("audience", on ? form.audience.filter((x) => x !== a) : [...form.audience, a])}
                    className={`press min-h-10 cursor-pointer rounded-[10px] border-0 px-3.5 text-sm font-semibold ${
                      on ? "bg-ink text-white" : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                    }`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="m-0 flex flex-col border-0 p-0">
            <legend className="mb-2.5 text-sm font-semibold">
              Tone <span className="font-normal text-muted">pick up to 2 · {form.tones.length} picked</span>
            </legend>
            <div className="grid gap-2.5 md:grid-cols-2">
              {TONES.map((t) => {
                const on = form.tones.includes(t.label);
                return (
                  <button
                    key={t.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pickTone(t.label)}
                    className={`press flex cursor-pointer flex-col gap-1 rounded-2xl border-0 p-3.5 text-left ${
                      on ? "bg-[#F2FAF5] shadow-[inset_0_0_0_2px_var(--color-primary)]" : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                    }`}
                  >
                    <span className="flex items-center justify-between text-[15px] font-semibold text-ink">
                      {t.label}
                      <span
                        aria-hidden="true"
                        className={`inline-flex size-5 items-center justify-center rounded-full text-white ${
                          on ? "bg-primary-strong" : "bg-surface shadow-[inset_0_0_0_1.5px_#9AA39C]"
                        }`}
                      >
                        {on && <CheckIcon size={11} />}
                      </span>
                    </span>
                    <span className="text-[13px] text-muted">{t.eg}</span>
                  </button>
                );
              })}
            </div>
            <p aria-live="polite" className="m-0 mt-2 min-h-5 text-sm text-muted">{toneNote}</p>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <ChipInput label="Words you use" values={form.wordsUse} onChange={(v) => set("wordsUse", v)} />
            <ChipInput
              label="Words you avoid"
              tone="neutral"
              values={form.wordsAvoid}
              onChange={(v) => set("wordsAvoid", v)}
            />
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2.5 text-sm font-semibold">
              Brand colours <span className="font-normal text-muted">used in graphics Brandbuild makes</span>
            </legend>
            <div role="radiogroup" aria-label="Brand colour" className="flex flex-wrap items-center gap-3">
              {[...new Set([...COLORS, form.color])].map((c) => (
                <label
                  key={c}
                  className={`relative inline-flex size-11 cursor-pointer rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-primary ${
                    form.color === c ? "shadow-[0_0_0_2px_var(--color-page),0_0_0_4px_var(--color-primary)]" : "shadow-[inset_0_0_0_1px_rgba(15,26,19,0.12)]"
                  }`}
                  style={{ background: c }}
                >
                  <input
                    type="radio"
                    name="brand-color"
                    checked={form.color === c}
                    onChange={() => set("color", c)}
                    aria-label={`Colour ${c}`}
                    className="sr-only"
                  />
                </label>
              ))}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-2 shadow-[inset_0_0_0_1px_#C7CCC1] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
                + Add colour
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set("color", e.target.value.toUpperCase())}
                  className="sr-only"
                />
              </label>
            </div>
          </fieldset>

          <Textarea
            id="brand-samples"
            label="Posts that sound like you"
            hint="Optional. The more you add, the closer the match."
            rows={3}
            value={form.samples}
            onChange={(e) => set("samples", e.target.value)}
            placeholder="Paste two or three captions you've written and liked"
          />

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
