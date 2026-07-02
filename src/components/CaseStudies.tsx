"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const BRANDS = ["Thriftifai", "Geeked", "Shokem", "SBJ foods", "Haity Gadgets"];

export function CaseStudies() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".case-col",
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.2,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 75%",
          }
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="bg-brand-black py-20 lg:py-[100px] text-white">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-8 items-center">
        
        {/* Column 1: Links */}
        <div className="case-col flex flex-col items-start gap-4">
          <span className="font-body text-[13px] text-white/50 uppercase tracking-widest mb-2">
            Case Studies
          </span>
          {BRANDS.map((brand, i) => (
            <button 
              key={i} 
              className={`font-display font-bold text-[24px] sm:text-[32px] text-left transition-colors ${i === 0 ? 'text-white' : 'text-white/40 hover:text-white/80'}`}
            >
              {brand}
            </button>
          ))}
          <a href="#" className="font-body font-bold text-white underline underline-offset-4 decoration-2 hover:text-brand-green mt-8">
            See all case studies ↗
          </a>
        </div>

        {/* Column 2: Image */}
        <div className="case-col relative w-full aspect-[3/4] max-w-[400px] mx-auto rounded-[24px] overflow-hidden border-2 border-white/10">
          <Image
            src="/assets/blog_image_3.png" // Using blog image 3 as placeholder for the spooky mug
            alt="Case Study"
            fill
            className="object-cover"
          />
        </div>

        {/* Column 3: Quote (Standardized to Testimonial style) */}
        <div className="case-col w-full flex flex-col relative">
          <span className="font-display font-black text-[60px] lg:text-[80px] leading-none text-[#2DBF6E] opacity-40 absolute -top-6 lg:-top-8 -left-4 pointer-events-none select-none">
            "
          </span>
          <p className="font-body font-light text-[18px] leading-[1.6] text-white/80 mb-8 relative z-10">
            Brandbuild literally gave me my weekends back. I plan my entire week of content in about 10 minutes, and the analytics finally make sense. Our engagement has never been higher.
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <span className="font-display font-bold text-[24px] text-white">10 hrs</span>
              <span className="font-body text-[12px] text-[#888]">Saved Weekly</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display font-bold text-[24px] text-white">300%</span>
              <span className="font-body text-[12px] text-[#888]">Audience Growth</span>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
