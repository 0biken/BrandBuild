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

        {/* Column 3: Green Quote Card */}
        <div className="case-col w-full">
          <div className="relative w-full max-w-[400px] mx-auto lg:ml-auto">
            {/* Shadow */}
            <div className="absolute inset-0 bg-[#000] rounded-[24px] translate-x-[8px] translate-y-[8px]" />
            
            {/* Card */}
            <div className="relative bg-brand-green rounded-[24px] border-2 border-brand-black p-8 text-white flex flex-col h-full">
              <span className="font-display font-black text-[64px] leading-none mb-4 opacity-50">"</span>
              <p className="font-body font-medium text-[16px] leading-[1.6] mb-8">
                Brandbuild literally changed how we approach creator partnerships. The revenue tracking showed us exactly what was working, allowing us to double down on top performers and scale our campaigns effortlessly.
              </p>
              
              <div className="mt-auto grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <span className="font-display font-bold text-[24px]">200+</span>
                  <span className="font-body text-[12px] opacity-80">Campaigns Run</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-display font-bold text-[24px]">99%</span>
                  <span className="font-body text-[12px] opacity-80">Creator Match</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
