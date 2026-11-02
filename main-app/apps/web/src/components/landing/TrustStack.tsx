"use client";

import { useRef } from "react";
import { MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { photo } from "@/lib/images";

const CARDS = [
  {
    title: "We never post without you.",
    body: "Brandbuild publishes only posts you’ve reviewed and scheduled.",
    tone: "bg-forest text-white",
    sub: "text-forest-ink",
    seed: "review-desk",
  },
  {
    title: "Disconnect any time.",
    body: "Remove an account in Settings and we stop using its access immediately.",
    tone: "bg-primary-hover text-white",
    sub: "text-white",
    seed: "unplugged-cable",
  },
  {
    title: "Delete everything.",
    body: "One button in Settings, or one email.",
    tone: "bg-lime text-forest",
    sub: "text-forest/80",
    seed: "clean-desk",
  },
];

/**
 * Card stacking: each card is sticky, and as the next one slides up over it
 * the previous card scales down and dims (scrubbed to scroll).
 */
export function TrustStack() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const cards = gsap.utils.toArray<HTMLElement>(".stack-card");
        cards.forEach((card, i) => {
          const next = cards[i + 1];
          if (!next) return;
          gsap.to(card, {
            scale: 0.92,
            opacity: 0.55,
            ease: "none",
            scrollTrigger: {
              trigger: next,
              start: "top 85%",
              end: "top 25%",
              scrub: true,
            },
          });
        });
        // Re-measure once images/fonts settle.
        ScrollTrigger.refresh();
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-label="Your control" className="px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-[22vh]">
        {CARDS.map((c, i) => (
          <article
            key={c.title}
            className={`stack-card sticky flex min-h-[420px] origin-top flex-col justify-between gap-12 overflow-hidden rounded-[36px] p-8 shadow-[0_40px_80px_-40px_rgba(15,42,27,0.5)] md:min-h-[480px] md:p-14 ${c.tone}`}
            style={{ top: `calc(6.5rem + ${i * 1.25}rem)` }}
          >
            <h2 className="m-0 max-w-4xl font-sans text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.045em]">
              {c.title}
            </h2>
            <div className="flex flex-wrap items-end justify-between gap-8">
              <p className={`m-0 max-w-md text-[19px] leading-relaxed ${c.sub}`}>{c.body}</p>
              <div
                aria-hidden="true"
                className="h-24 w-44 rounded-full bg-cover bg-center opacity-90 contrast-125 grayscale-[30%] max-md:hidden"
                style={{ backgroundImage: `url(${photo(c.seed, 600, 300)})` }}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
