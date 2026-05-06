"use client";

import { useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";

export function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      // Entry Animation
      if (copyRef.current && imageRef.current) {
        gsap.fromTo(
          copyRef.current.children,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.7, stagger: 0.15, ease: "power3.out" }
        );
        gsap.fromTo(
          imageRef.current.children,
          { opacity: 0, scale: 0.95, y: 20 },
          { opacity: 1, scale: 1, y: 0, duration: 0.8, stagger: 0.2, delay: 0.3, ease: "power3.out" }
        );
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section 
      ref={containerRef}
      className="relative min-h-[90vh] w-full bg-wavy-pattern overflow-hidden pt-32 pb-16 lg:pt-[160px]"
    >
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 h-full flex flex-col lg:flex-row items-center justify-between relative z-10 gap-16 lg:gap-8">
        
        {/* Copy Column */}
        <div ref={copyRef} className="flex-1 w-full flex flex-col items-start max-w-[600px]">
          <h1 className="font-display font-black text-[56px] lg:text-[72px] leading-[1.05] tracking-tight text-brand-black mb-6">
            Unforgettable campaigns start with insight!
          </h1>

          <p className="font-body font-medium text-[18px] lg:text-[22px] leading-[1.5] text-brand-black/80 mb-10">
            Social media management built for brands and designed for growth.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <Link href="#waitlist" className="btn-primary w-full sm:w-auto justify-center">
              Start your Campaign
            </Link>
            <Link href="#waitlist" className="btn-ghost-green w-full sm:w-auto justify-center">
              Join the Beta
              <span className="text-xl leading-none">↗</span>
            </Link>
          </div>
        </div>

        {/* Image Column */}
        <div ref={imageRef} className="flex-1 w-full relative h-[400px] sm:h-[500px] lg:h-[600px] flex items-center justify-center lg:justify-end">
          
          {/* Main larger card */}
          <div className="absolute right-[5%] sm:right-[15%] lg:right-0 top-0 w-[60%] sm:w-[50%] lg:w-[320px] aspect-[3/4] rounded-[32px] overflow-hidden shadow-brutalist z-10">
            <Image
              src="/assets/hero_image_1.png"
              alt="Creator"
              fill
              className="object-cover bg-[#FFD7BA]"
              priority
            />
          </div>

          {/* Secondary overlapping card */}
          <div className="absolute left-[5%] sm:left-[20%] lg:left-10 bottom-[10%] w-[55%] sm:w-[45%] lg:w-[280px] aspect-[4/5] rounded-[32px] overflow-hidden shadow-brutalist z-20">
            <Image
              src="/assets/hero_image_2.png"
              alt="Creator showing phone"
              fill
              className="object-cover bg-[#DCD8FF]"
              priority
            />
          </div>

        </div>

      </div>
    </section>
  );
}
