"use client";

import { useRef } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { photo } from "@/lib/images";

/**
 * Image scale and fade: images start at 0.8, grow to 1 as they enter, then
 * darken and fade toward 0.2 as they leave the viewport.
 */
export function Students() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.utils.toArray<HTMLElement>(".fade-img").forEach((el) => {
          gsap.fromTo(
            el,
            { scale: 0.8 },
            {
              scale: 1,
              ease: "none",
              scrollTrigger: { trigger: el, start: "top 95%", end: "top 40%", scrub: true },
            },
          );
          gsap.to(el, {
            opacity: 0.2,
            filter: "brightness(0.5)",
            ease: "none",
            scrollTrigger: { trigger: el, start: "bottom 55%", end: "bottom 5%", scrub: true },
          });
        });
      });
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      id="students"
      className="scroll-mt-24 overflow-hidden bg-forest px-6 py-32 text-forest-text md:px-12 md:py-48"
    >
      <div className="mx-auto grid max-w-[1280px] items-center gap-16 md:grid-cols-12">
        <div className="flex flex-col gap-8 md:col-span-6">
          <h2 className="m-0 font-sans text-[clamp(2.5rem,5vw,4.5rem)] leading-[1] font-semibold tracking-[-0.045em] text-white">
            Running a brand from your hostel? It&apos;s free.
          </h2>
          <p className="m-0 max-w-lg text-[19px] leading-relaxed text-forest-ink">
            Verify with your school email and get Student Access free until [END DATE].
            Every core feature, no card.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <ButtonLink href="/signup" variant="lime" size="lg" className="rounded-full">
              Get Student Access
            </ButtonLink>
            <span className="text-sm text-forest-ink">Takes about a minute</span>
          </div>
        </div>

        <div className="grid grid-cols-2 items-start gap-4 md:col-span-6">
          <div
            aria-hidden="true"
            className="fade-img mt-16 aspect-[3/4] rounded-[28px] bg-cover bg-center contrast-125 grayscale-[30%]"
            style={{ backgroundImage: `url(${photo("campus-founder", 800, 1066)})` }}
          />
          <div
            aria-hidden="true"
            className="fade-img aspect-[3/4] rounded-[28px] bg-cover bg-center contrast-125 grayscale-[30%]"
            style={{ backgroundImage: `url(${photo("hostel-desk-brand", 800, 1066)})` }}
          />
        </div>
      </div>
    </section>
  );
}
