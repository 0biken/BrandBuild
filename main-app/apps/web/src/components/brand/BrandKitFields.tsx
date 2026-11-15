"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/FormControls";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import type { BrandProfile } from "@/lib/api/types";
import {
  BRAND_FONTS,
  DEFAULT_FONTS,
  MAX_PALETTE,
  fontStack,
  isHex,
  loadBrandFonts,
  logoProblem,
  logoToDataUrl,
} from "@/lib/brandKit";

const SUGGESTED = ["#F4C7B8", "#D62976", "#C8F169", "#F2EDE4", "#1F6FEB", "#FFB000"];

/** Logo, colours and fonts: the visual half of the brand profile. */
export function BrandKitFields({
  form,
  onChange,
}: {
  form: BrandProfile;
  /** Takes an updater, so edits made while a logo loads aren't lost. */
  onChange: (update: (prev: BrandProfile) => BrandProfile) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState("");
  const palette = form.palette ?? [];
  const fonts = form.fonts ?? DEFAULT_FONTS;

  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) => onChange((prev) => ({ ...prev, [k]: v }));

  useEffect(() => loadBrandFonts([fonts.heading, fonts.body]), [fonts.heading, fonts.body]);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) {
      setLogoError(problem);
      return;
    }
    setLogoError("");
    set("logo", await logoToDataUrl(file));
  }

  function setPaletteAt(i: number, hex: string) {
    onChange((prev) => {
      const next = [...(prev.palette ?? [])];
      next[i] = hex.toUpperCase();
      return { ...prev, palette: next };
    });
  }

  const colours = [form.color, ...palette];

  return (
    <section id="kit" aria-labelledby="kit-title" className="flex scroll-mt-6 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="kit-title" className="m-0 font-display text-xl font-bold tracking-[-0.02em]">
          Brand kit
        </h2>
        <p className="m-0 text-[15px] text-ink-2">Your logo, colours and fonts show up in previews and graphics Brandbuild makes.</p>
      </div>

      {/* Logo */}
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-semibold">Logo</span>
        <div
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line-strong bg-surface p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pickLogo(e.dataTransfer.files[0]);
          }}
        >
          <span className="inline-flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-page shadow-[inset_0_0_0_1px_var(--color-line)]">
            {form.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL, not optimisable
              <img src={form.logo} alt="Your logo" className="size-full object-contain p-1.5" />
            ) : (
              <span
                aria-hidden="true"
                className="inline-flex size-full items-center justify-center font-display text-3xl font-bold text-white"
                style={{ background: form.color }}
              >
                {(form.name || "B").charAt(0)}
              </span>
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-sm text-muted">PNG, JPG, WebP or SVG, up to 2 MB. A square logo works best.</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                {form.logo ? "Replace logo" : "Upload logo"}
              </Button>
              {form.logo && (
                <Button variant="ghost" onClick={() => set("logo", undefined)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            aria-label="Logo file"
            className="sr-only"
            onChange={(e) => {
              pickLogo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {logoError && (
          <p role="alert" className="m-0 text-sm font-medium text-danger-ink">
            {logoError}
          </p>
        )}
      </div>

      {/* Colours */}
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 text-sm font-semibold">
          Brand colours <span className="font-normal text-muted">primary first, then up to {MAX_PALETTE} more</span>
        </legend>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {colours.map((c, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface p-2.5 shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
              <label
                className="relative inline-flex size-11 shrink-0 cursor-pointer rounded-xl shadow-[inset_0_0_0_1px_rgba(15,26,19,0.12)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
                style={{ background: c }}
              >
                <input
                  type="color"
                  value={c}
                  aria-label={i === 0 ? "Primary colour" : `Colour ${i + 1}`}
                  onChange={(e) => (i === 0 ? set("color", e.target.value.toUpperCase()) : setPaletteAt(i - 1, e.target.value))}
                  className="sr-only"
                />
              </label>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs font-semibold text-muted">{i === 0 ? "Primary" : `Colour ${i + 1}`}</span>
                <HexInput
                  value={c}
                  label={i === 0 ? "Primary colour hex" : `Colour ${i + 1} hex`}
                  onValid={(hex) => (i === 0 ? set("color", hex) : setPaletteAt(i - 1, hex))}
                />
              </span>
              {i > 0 && (
                <button
                  type="button"
                  aria-label={`Remove colour ${i + 1}`}
                  onClick={() => set("palette", palette.filter((_, j) => j !== i - 1))}
                  className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted fine:hover:bg-page-hover"
                >
                  <CloseIcon size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {palette.length < MAX_PALETTE && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => set("palette", [...palette, SUGGESTED.find((s) => !colours.includes(s)) ?? "#CCCCCC"])}
            >
              <PlusIcon size={16} />
              Add colour
            </Button>
          </div>
        )}
      </fieldset>

      {/* Fonts */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(["heading", "body"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-2">
            <Select
              id={`font-${k}`}
              label={k === "heading" ? "Heading font" : "Body font"}
              value={fonts[k]}
              onChange={(e) => set("fonts", { ...fonts, [k]: e.target.value })}
            >
              {BRAND_FONTS.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
            <span
              className={k === "heading" ? "text-2xl font-bold" : "text-[15px]"}
              style={{ fontFamily: fontStack(fonts[k]) }}
            >
              {k === "heading" ? "The new drop is here" : "Handmade in small batches, packed with care."}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Hex text field that only reports a value once it's a full #RRGGBB. */
function HexInput({ value, label, onValid }: { value: string; label: string; onValid: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // Follow outside changes (colour picker, discard) without an effect.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <input
      value={draft}
      aria-label={label}
      spellCheck={false}
      maxLength={7}
      onChange={(e) => {
        const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
        setDraft(v);
        if (isHex(v)) onValid(v.toUpperCase());
      }}
      onBlur={() => setDraft(value)}
      className="w-full min-w-0 border-0 bg-transparent p-0 font-mono text-[15px] text-ink uppercase focus:outline-none"
    />
  );
}
