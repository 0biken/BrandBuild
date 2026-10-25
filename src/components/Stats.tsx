"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const STATS = [
  { icon: "/assets/rocket_icon.svg", value: 1, suffix: "M+", label: "posts published automatically" },
  { icon: "/assets/binocular_icon.svg", value: 50, suffix: "+", label: "native platform integrations" },
  { icon: "/assets/coin_icon.svg", value: 15, suffix: "", label: "hours average time saved weekly" },
  { icon: "/assets/checkmark.svg", value: 99.9, suffix: "%", label: "platform uptime reliability", decimals: 1 },
];



export function Stats() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      const trigger = { trigger: sectionRef.current, start: "top 80%", once: true };

      // Cards flip up toward the viewer, one after another
      gsap.fromTo(
        ".stat-item",
        { opacity: 0, y: 24, rotationX: -35, transformPerspective: 900, transformOrigin: "50% 100%" },
        {
          opacity: 1,
          y: 0,
          rotationX: 0,
          duration: 0.8,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: trigger,
        }
      );

      // Numbers count up from zero as their card lands
      gsap.utils.toArray<HTMLElement>(".stat-value").forEach((el, i) => {
        const target = Number(el.dataset.value);
        const decimals = Number(el.dataset.decimals) || 0;
        const counter = { val: 0 };
        gsap.to(counter, {
          val: target,
          duration: 1.4,
          delay: i * 0.08,
          ease: "power2.out",
          scrollTrigger: trigger,
          onUpdate: () => {
            el.textContent = counter.val.toFixed(decimals);
          },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="bg-wavy-pattern py-20 lg:py-[100px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 text-center">
        
        <h2 className="font-display font-black text-[32px] sm:text-[40px] text-brand-black mb-16">
          Numbers don’t lie!
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
              <div className="absolute inset-0 bg-brand-green cutout-tr flex flex-col p-6 items-start justify-end transition-transform duration-200 ease-[var(--ease-out)] hover:-translate-y-1 hover:-translate-x-1 active:translate-x-[4px] active:translate-y-[4px] active:duration-100">
                
                <div className="absolute top-6 left-6 h-10 w-10 flex items-center justify-center">
                  <Image src={stat.icon} alt="" width={32} height={32} className="object-contain" />
                </div>
                
                <div className="font-display font-black text-[40px] text-white leading-none mb-2 mt-auto">
                  <span className="stat-value tabular-nums" data-value={stat.value} data-decimals={stat.decimals ?? 0}>
                    {stat.decimals ? stat.value.toFixed(stat.decimals) : stat.value}
                  </span>
                  {stat.suffix}
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
