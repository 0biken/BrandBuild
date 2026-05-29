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
          <h1 className="font-display font-black text-[40px] sm:text-[56px] lg:text-[64px] leading-[1.05] tracking-tight text-brand-black mb-6">
            Find creators who drive sales. <br/>
            <span className="text-brand-green">Get brands that pay fairly.</span>
          </h1>

          <p className="font-body font-medium text-[16px] sm:text-[18px] lg:text-[20px] leading-[1.5] text-brand-black/80 mb-6 sm:mb-8 max-w-[500px]">
            No minimum spend. No agency fees. The only platform built for small businesses and independent creators to grow together.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto mb-6">
            <Link href="#waitlist" className="btn-primary w-full sm:w-auto justify-center text-[16px] py-4 px-8">
              Join the Waitlist
            </Link>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-gray-200 overflow-hidden relative">
                  <Image src={`/assets/hero_image_1.png`} alt="User" fill className="object-cover" />
                </div>
              ))}
            </div>
            <p className="font-body text-[14px] font-medium text-brand-black/70">
              Join <strong className="text-brand-black">500+</strong> local businesses and creators.
            </p>
          </div>
        </div>

        {/* Image Column */}
        <div ref={imageRef} className="flex-1 w-full relative flex items-center justify-center lg:justify-end min-h-[400px] sm:min-h-[500px]">
          
          <div className="relative w-full max-w-[500px] h-[400px] sm:h-[500px] mx-auto lg:mr-0">
            
            {/* Image 1 (Right side - Skincare) */}
            <div className="absolute z-10 right-0 top-0 w-[60%] sm:w-[300px] h-[75%] sm:h-[370px] rounded-[30px] overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.1)] transition-transform duration-300 hover:scale-105 hover:z-30 bg-[#FDE8D4]">
              <Image
                src="/assets/hero_image_1.png"
                alt="Woman with skincare patches"
                fill
                className="object-cover"
                priority
              />
            </div>

            {/* Image 2 (Left side - Pink jacket/Girl) */}
            <div className="absolute z-20 left-0 top-[20%] sm:top-[130px] w-[60%] sm:w-[300px] h-[75%] sm:h-[370px] rounded-[30px] overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.1)] border-[6px] sm:border-[8px] border-[#fcfcfc] transition-transform duration-300 hover:scale-105 hover:z-30 bg-[#E3E6F3]">
              <Image
                src="/assets/hero_image_2.png"
                alt="Girl taking selfie"
                fill
                className="object-cover"
                priority
              />
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
