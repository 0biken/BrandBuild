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
          <h1 className="font-display font-black text-[36px] sm:text-[56px] lg:text-[72px] leading-[1.05] tracking-tight text-brand-black mb-6">
            Unforgettable campaigns start with insight!
          </h1>

          <p className="font-body font-medium text-[16px] sm:text-[18px] lg:text-[22px] leading-[1.5] text-brand-black/80 mb-6 sm:mb-10">
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
        <div ref={imageRef} className="flex-1 w-full relative flex items-center justify-center lg:justify-end min-h-[400px] sm:min-h-[500px] lg:min-h-[600px]">
          
          <div className="relative w-full max-w-[495px] aspect-[495/571] mr-0 lg:mr-4">
            
            {/* Secondary overlapping card (hero_image_2, bottom left) */}
            <div 
              className="absolute z-20 overflow-hidden"
              style={{
                width: '60.87%',
                height: '65.07%',
                left: '0%',
                top: '34.93%',
                borderRadius: '20px',
                clipPath: 'polygon(0% 0%, 60% 0%, 60% 40%, 100% 40%, 100% 100%, 0% 100%)'
              }}
            >
              <Image
                src="/assets/hero_image_2.png"
                alt="Creator showing phone"
                fill
                className="object-cover bg-[#DCD8FF]"
                priority
              />
            </div>

            {/* Main larger card (hero_image_1, top right) */}
            <div 
              className="absolute z-10 overflow-hidden"
              style={{
                width: '60.87%',
                height: '65.07%',
                left: '39.13%',
                top: '0%',
                borderRadius: '20px',
                clipPath: 'polygon(0% 0%, 60% 0%, 60% 40%, 100% 40%, 100% 100%, 0% 100%)'
              }}
            >
              <Image
                src="/assets/hero_image_1.png"
                alt="Creator"
                fill
                className="object-cover bg-[#FFD7BA]"
                priority
              />
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
