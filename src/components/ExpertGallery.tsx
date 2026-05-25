"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";

gsap.registerPlugin(ScrollTrigger);

const CREATORS = [
  { name: "Creator 01", handle: "@creator01" },
  { name: "Creator 02", handle: "@creator02" },
  { name: "Gia Johnson", handle: "@giajohnson" },
  { name: "Creator 04", handle: "@creator04" },
  { name: "Creator 05", handle: "@creator05" },
];

export function ExpertGallery() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      if (carouselRef.current) {
        gsap.fromTo(
          carouselRef.current.children,
          { opacity: 0, y: 50 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            stagger: 0.1,
            ease: "back.out(1.2)",
            scrollTrigger: {
              trigger: sectionRef.current,
              start: "top 70%",
            }
          }
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section id="creators" ref={sectionRef} className="bg-wavy-pattern py-20 lg:py-[100px] overflow-hidden text-center">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20">
        
        <h2 className="font-display font-black text-[32px] sm:text-[40px] lg:text-[48px] text-brand-black mb-16">
          Meet Our Experts!
        </h2>

        {/* Center focused layout */}
        <div 
          ref={carouselRef} 
          className="flex justify-center items-end gap-4 lg:gap-8 mb-16 h-[320px]"
        >
          {CREATORS.map((creator, i) => {
            // Make the middle item larger
            const isCenter = i === 2;
            const sizeClass = isCenter ? "w-[240px] h-[300px]" : "w-[180px] h-[220px] hidden sm:flex";
            const mobileSizeClass = isCenter ? "flex" : "hidden sm:flex";

            return (
              <div 
                key={i}
                className={`relative ${sizeClass} ${mobileSizeClass}`}
              >
                {/* Shadow */}
                <div className={`absolute inset-0 bg-brand-black cutout-tr translate-x-[8px] translate-y-[8px]`} />
                
                {/* Card */}
                <div className={`absolute inset-0 bg-brand-green cutout-tr flex flex-col pt-0 px-0 pb-4 items-center transition-transform hover:-translate-y-2 duration-300`}>
                  
                  {/* Photo area */}
                  <div className="w-full h-[65%] mb-auto overflow-hidden relative">
                    <Image src="/assets/hero_image_1.png" alt="" fill className="object-cover" />
                  </div>
                  
                  <div className="px-4 text-center mt-2 flex flex-col items-center">
                    <h3 className={`font-display font-bold text-white leading-tight ${isCenter ? 'text-[20px]' : 'text-[16px]'}`}>
                      {creator.name}
                    </h3>
                    <span className={`font-body text-white/80 ${isCenter ? 'text-[14px]' : 'text-[12px]'}`}>
                      {creator.handle}
                    </span>
                  </div>
                  
                </div>
              </div>
            );
          })}
        </div>

        <p className="font-body text-[18px] text-brand-black/80 max-w-[600px] mx-auto font-medium">
          We match you with verified, proven creators who actually sell. Built for brands, managed by us, performance guaranteed.
        </p>

      </div>
    </section>
  );
}
