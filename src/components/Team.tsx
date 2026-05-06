"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function Team() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      if (contentRef.current) {
        gsap.fromTo(
          contentRef.current.children,
          { opacity: 0, x: -40 },
          {
            opacity: 1,
            x: 0,
            duration: 0.8,
            stagger: 0.2,
            ease: "power3.out",
            scrollTrigger: {
              trigger: sectionRef.current,
              start: "top 60%",
            }
          }
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-[160px] overflow-hidden flex items-center justify-start border-y-2 border-brand-black">
      
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/assets/team_behind_your_campaigns background image.jpg"
          alt="The team behind your campaigns"
          fill
          className="object-cover"
          sizes="100vw"
        />
      </div>

      {/* Floating Green Content Blocks */}
      <div className="relative z-10 max-w-[1440px] w-full mx-auto px-6 lg:px-20">
        <div ref={contentRef} className="flex flex-col items-start gap-4 max-w-[600px]">
          
          <div className="bg-[#6b9a2d]/90 backdrop-blur-sm rounded-[24px] p-6 lg:p-8 border-2 border-white/20 text-white">
            <p className="font-body text-[18px] lg:text-[20px] font-medium leading-[1.5]">
              Expert strategists, vetted creators, and data analysts — all working on your campaign.
            </p>
            <button className="btn-primary mt-6 !bg-brand-black !text-white border border-white/20 shadow-brutalist">
              Get started →
            </button>
          </div>

          <div className="bg-[#6b9a2d]/90 backdrop-blur-sm rounded-[24px] p-4 px-8 border-2 border-white/20 text-white translate-x-12">
            <h2 className="font-display font-black text-[32px] lg:text-[40px] leading-none">
              The team behind your campaigns
            </h2>
          </div>

        </div>
      </div>
      
    </section>
  );
}
