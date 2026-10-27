"use client";

import { useState } from "react";
import { photo } from "@/lib/images";

const STEPS = [
  {
    n: "01",
    title: "Teach it your voice",
    body: "Pick a tone, the words you use and the ones you never would. Paste a few posts you like. Takes two minutes.",
    seed: "workshop-notes",
  },
  {
    n: "02",
    title: "Type one line",
    body: "“Behind the scenes of Friday’s drop.” Brandbuild writes the caption, picks hashtags and suggests a time.",
    seed: "packing-orders",
  },
  {
    n: "03",
    title: "Check it and schedule",
    body: "See exactly how it looks on each platform. Edit anything, then schedule. Nothing posts without your OK.",
    seed: "launch-day-desk",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);

  return (
    <section id="how" className="scroll-mt-24 px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto max-w-[1280px]">
        <h2 className="m-0 max-w-5xl font-sans text-[clamp(2.5rem,5vw,4.5rem)] leading-[1] font-semibold tracking-[-0.04em]">
          Three steps from
          <span
            aria-hidden="true"
            className="mx-[0.14em] inline-block h-[0.72em] w-[1.6em] -translate-y-[0.04em] rounded-full bg-cover bg-center align-middle"
            style={{ backgroundImage: `url(${photo("sketchbook-idea", 480, 220)})` }}
          />
          idea to scheduled.
        </h2>

        <ol className="m-0 mt-16 flex list-none gap-3 p-0 md:h-[560px] max-md:flex-col md:mt-24">
          {STEPS.map((s, i) => {
            const open = active === i;
            return (
              <li
                key={s.n}
                className="relative min-w-0 overflow-hidden rounded-[28px] bg-forest transition-[flex-grow] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] max-md:min-h-[360px] md:flex-1"
                style={{ flexGrow: open ? 3.4 : 1 }}
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-cover bg-center opacity-50 mix-blend-luminosity contrast-125 transition-transform duration-700 ease-out"
                  style={{
                    backgroundImage: `url(${photo(s.seed, 1100, 1100)})`,
                    transform: open ? "scale(1.05)" : "scale(1)",
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-forest via-forest/55 to-forest/20" />

                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`how-${s.n}`}
                  onClick={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setActive(i);
                  }}
                  className="absolute inset-0 z-10 flex cursor-pointer flex-col justify-between border-0 bg-transparent p-7 text-left text-white md:p-8"
                >
                  <span className="font-display text-[44px] leading-none font-bold tracking-[-0.04em] text-lime md:text-[56px]">
                    {s.n}
                  </span>

                  <span className="flex flex-col gap-3">
                    <span
                      className={`font-sans text-[clamp(1.4rem,2.2vw,2rem)] leading-tight font-semibold tracking-[-0.03em] transition-opacity duration-300 md:whitespace-nowrap ${
                        open ? "" : "md:[writing-mode:vertical-rl] md:rotate-180 md:text-forest-text"
                      }`}
                    >
                      {s.title}
                    </span>
                    <span
                      id={`how-${s.n}`}
                      className={`max-w-md text-base leading-relaxed text-forest-text transition-opacity duration-500 ${
                        open ? "opacity-100 delay-200" : "opacity-100 md:pointer-events-none md:h-0 md:overflow-hidden md:opacity-0"
                      }`}
                    >
                      {s.body}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
