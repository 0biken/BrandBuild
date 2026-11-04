"use client";

import { useRef, type CSSProperties } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { photo } from "@/lib/images";

const STEPS = [
  "Brand voice read",
  "Caption written",
  "4 hashtags picked",
  "Best time: Fri 7 PM",
];

/** Stagger index for the CSS intro animations in globals.css. */
const order = (i: number) => ({ "--i": i }) as CSSProperties;

function Pill({ seed }: { seed: string }) {
  return (
    <span
      aria-hidden="true"
      className="mx-[0.12em] inline-block h-[0.74em] w-[1.7em] -translate-y-[0.04em] rounded-full bg-cover bg-center align-middle shadow-[inset_0_0_0_1px_rgba(15,26,19,0.08)]"
      style={{ backgroundImage: `url(${photo(seed, 480, 220)})` }}
    />
  );
}

const Word = ({ children, i }: { children: string; i: number }) => (
  <span className="-mb-[0.16em] inline-block overflow-hidden pb-[0.16em] align-bottom">
    <span className="hero-word inline-block will-change-transform" style={order(i)}>
      {children}
    </span>
  </span>
);

export function Hero() {
  const root = useRef<HTMLElement>(null);

  // The intro runs in CSS (first paint, no hydration wait). GSAP only drives
  // the scroll-linked parallax on the photo.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.to(".hero-photo-inner", {
          yPercent: -8,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      className="relative isolate overflow-hidden px-6 pt-40 pb-24 md:px-12 md:pt-48 md:pb-40"
    >
      {/* Ambient wash: deep radial blurs, no flat fill */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -right-40 size-[760px] rounded-full bg-lime/55 blur-[130px]" />
        <div className="absolute top-1/3 -left-52 size-[640px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.7),transparent_60%)]" />
      </div>

      <div className="mx-auto max-w-[1280px]">
        <h1 className="m-0 max-w-6xl font-sans text-[clamp(2.4rem,6.2vw,5.75rem)] leading-[0.98] font-semibold tracking-[-0.045em] text-ink">
          <Word i={0}>Posts</Word> <Word i={1}>that</Word> <Word i={2}>sound</Word>{" "}
          <Pill seed="studio-hands" /> <Word i={3}>like</Word> <Word i={4}>you.</Word>{" "}
          <Word i={5}>Written</Word> <Word i={6}>in</Word> <Word i={7}>seconds.</Word>
        </h1>

        <div className="mt-10 grid gap-14 md:mt-14 md:grid-cols-12">
          <div className="flex flex-col gap-8 md:col-span-6">
            <p className="hero-fade m-0 max-w-xl text-[19px] leading-relaxed text-ink-2" style={order(0)}>
              Type an idea. Brandbuild writes the caption in your voice, picks the
              hashtags and the best time, and schedules it to every account
              you&apos;ve connected.
            </p>
            <div className="hero-fade flex flex-wrap gap-3" style={order(1)}>
              <ButtonLink href="/signup" variant="primary" size="lg" className="rounded-full pr-5">
                Write my post
                <ArrowRightIcon size={18} />
              </ButtonLink>
              <ButtonLink href="/#how" variant="outline" size="lg" className="rounded-full">
                See how it works
              </ButtonLink>
            </div>
            <p className="hero-fade m-0 text-sm text-muted" style={order(2)}>
              Free for students with a school email. No card needed.
            </p>
          </div>

          {/* Photo sits below the headline, never over it. The status card
              hangs off its top-left corner, clear of the caption card. */}
          <div className="relative md:col-span-6">
            <div className="hero-photo relative ml-auto aspect-[4/5] w-full max-w-[520px] overflow-hidden rounded-[36px] bg-forest shadow-[0_50px_90px_-40px_rgba(15,42,27,0.65)]">
              <div
                className="hero-photo-inner absolute -inset-x-0 -top-[8%] h-[116%] bg-cover bg-center opacity-90 contrast-125 grayscale-[35%]"
                style={{ backgroundImage: `url(${photo("small-brand-studio", 1000, 1250)})` }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest/85 via-forest/10 to-transparent" />
              <div className="absolute inset-x-5 bottom-5 rounded-2xl bg-white/90 p-4 shadow-lg backdrop-blur-md">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted">
                  <span className="inline-flex size-6 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">
                    IG
                  </span>
                  novastudio.co
                </div>
                <p className="m-0 text-[15px] leading-snug text-ink">
                  Our new lip care line launches Friday. Handmade in small batches
                  and tested by our team before it reaches you.
                </p>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="hero-card absolute top-10 left-0 w-[260px] rounded-[22px] bg-forest p-5 text-forest-text shadow-[0_30px_60px_-30px_rgba(15,42,27,0.8)] max-md:left-3 md:-left-6"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-display text-[18px] font-bold text-white">Building your post</span>
                <span className="font-mono text-xs text-forest-ink">4 of 4</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {STEPS.map((s) => (
                  <li key={s} className="flex items-center gap-2.5">
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-lime text-forest">
                      <CheckIcon size={12} />
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
