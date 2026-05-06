"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const STATS = [
  { icon: "/assets/binocular_icon.svg", value: 15, suffix: "K+", label: "verified creators" },
  { icon: "/assets/rocket_icon.svg", value: 200, suffix: "+", label: "brand campaigns run" },
  { icon: "/assets/link_icon.svg", value: 99.9, suffix: "%", label: "ROI tracking overall", decimals: 1 },
  { icon: "/assets/star_icon.svg", value: 99.9, suffix: "%", label: "brand safety rate", decimals: 1 },
];

function CountUp({ end, prefix = "", suffix = "", decimals = 0 }: { end: number, prefix?: string, suffix?: string, decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      if (ref.current) ref.current.innerText = `${prefix}${end}${suffix}`;
      return;
    }

    const ctx = gsap.context(() => {
      if (ref.current) {
        ScrollTrigger.create({
          trigger: ref.current,
          start: "top 85%",
          onEnter: () => {
            gsap.to({ val: 0 }, {
              val: end,
              duration: 2,
              ease: "power3.out",
              onUpdate: function() {
                if (ref.current) {
                  const currentVal = this.targets()[0].val;
                  const displayVal = decimals > 0 ? currentVal.toFixed(decimals) : Math.round(currentVal);
                  ref.current.innerText = `${prefix}${displayVal}${suffix}`;
                }
              }
            });
          },
          once: true
        });
      }
    });

    return () => ctx.revert();
  }, [end, prefix, suffix, decimals]);

  return <span ref={ref}>{prefix}0{suffix}</span>;
}

export function Stats() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".stat-item",
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 80%",
          }
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="bg-wavy-pattern py-20 lg:py-[100px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 text-center">
        
        <h2 className="font-display font-black text-[40px] text-brand-black mb-16">
          Numbers don't lie!
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-12 place-items-center">
          {STATS.map((stat, i) => (
            <div 
              key={i} 
              className="stat-item relative w-full max-w-[240px] h-[220px]"
            >
              {/* Drop Shadow Element (Black) */}
              <div className="absolute inset-0 bg-[#111] cutout-tr translate-x-[8px] translate-y-[8px]" />
              
              {/* Main Card (Green) */}
              <div className="absolute inset-0 bg-brand-green cutout-tr border-2 border-brand-black flex flex-col p-6 items-start justify-end transition-transform hover:-translate-y-1 hover:-translate-x-1 duration-200">
                
                <div className="absolute top-6 left-6 h-10 w-10 flex items-center justify-center">
                  <Image src={stat.icon} alt="" width={32} height={32} className="object-contain" />
                </div>
                
                <div className="font-display font-black text-[40px] text-white leading-none mb-2 mt-auto">
                  <CountUp end={stat.value} suffix={stat.suffix} decimals={stat.decimals} />
                </div>
                
                <div className="font-body text-[13px] font-medium text-white/90 leading-snug text-left">
                  {stat.label}
                </div>

              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
