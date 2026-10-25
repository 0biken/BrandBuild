"use client";

import { useRef, useEffect } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTilt } from "./useTilt";

gsap.registerPlugin(ScrollTrigger);

export function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useTilt(stageRef, 7);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>(".hero-card");

      // Push each card to its depth so the stage tilt reads as real 3D parallax
      cards.forEach((card) => gsap.set(card, { z: Number(card.dataset.depth) || 0 }));

      // Image entrance. The copy column animates in CSS (.reveal) so the headline never flashes.
      gsap.fromTo(
        cards,
        { opacity: 0, y: 28, rotationY: -12 },
        { opacity: 1, y: 0, rotationY: 0, duration: 0.9, stagger: 0.12, delay: 0.15, ease: "power3.out" }
      );

      // As the hero scrolls away, the front card drifts faster than the back one
      cards.forEach((card, i) => {
        gsap.to(card, {
          yPercent: i === 0 ? -8 : -22,
          ease: "none",
          scrollTrigger: { trigger: containerRef.current, start: "top top", end: "bottom top", scrub: true },
        });
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section 
      ref={containerRef}
      className="relative min-h-[80vh] sm:min-h-[90vh] w-full bg-wavy-pattern overflow-hidden pt-28 sm:pt-32 pb-12 sm:pb-16 lg:pt-[160px]"
    >
      <div className="max-w-[1440px] mx-auto px-5 sm:px-6 lg:px-20 h-full flex flex-col lg:flex-row items-center justify-between relative z-10 gap-10 sm:gap-16 lg:gap-8">
        
        {/* Copy Column */}
        <div className="flex-1 w-full flex flex-col items-center text-center lg:items-start lg:text-left max-w-[600px]">
          <h1 className="font-display font-black text-[40px] sm:text-[56px] lg:text-[64px] leading-[1.05] tracking-tight text-brand-black mb-6">
            Your brand, everywhere. <br/>
            <span className="text-brand-green">Without the burnout.</span>
          </h1>

          <p style={{ "--i": 1 } as React.CSSProperties} className="reveal font-body font-medium text-[16px] sm:text-[18px] lg:text-[20px] leading-[1.5] text-brand-black/80 mb-6 sm:mb-8 max-w-[500px]">
            One dashboard. Every platform. Posts that write themselves, a calendar that fills itself, and insights that actually make sense. Get back to running your business.
          </p>

          <div style={{ "--i": 2 } as React.CSSProperties} className="reveal flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto mb-6 justify-center lg:justify-start">
            <a href="https://docs.google.com/forms/d/1rsoSzN4C5JzlHdBaZkEPtP_MAm2cshrcp5icvFeobbw/viewform" target="_blank" rel="noopener noreferrer" className="btn-primary w-full sm:w-auto justify-center text-[16px] py-4 px-8">
              Join the Waitlist
            </a>
          </div>
          
          <div style={{ "--i": 3 } as React.CSSProperties} className="reveal flex items-center gap-3 justify-center lg:justify-start">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-gray-200 overflow-hidden relative">
                  <Image src={`/assets/hero_image_1.png`} alt="User" fill className="object-cover" />
                </div>
              ))}
            </div>
            <p className="font-body text-[14px] font-medium text-brand-black/70">
              Join <strong className="text-brand-black">500+</strong> businesses already growing smarter.
            </p>
          </div>
        </div>

        {/* Image Column */}
        <div ref={imageRef} className="flex-1 w-full relative flex items-center justify-center lg:justify-end min-h-[400px] sm:min-h-[500px]">

          {/* 3D stage: tilts toward the pointer; the cards sit at different depths */}
          <div ref={stageRef} className="relative w-full max-w-[400px] sm:max-w-[500px] h-[340px] sm:h-[500px] mx-auto lg:mr-0">

            {/* The PNGs carry the brand cutout shape in their alpha, so no frame or background here */}
            <div data-depth="0" className="hero-card absolute z-10 right-0 top-0 w-[62%] sm:w-[300px] drop-shadow-[0_18px_28px_rgba(17,17,17,0.14)]">
              <Image
                src="/assets/hero_image_1.png"
                alt="Woman with skincare patches"
                width={302}
                height={372}
                className="w-full h-auto"
                priority
              />
            </div>

            <div data-depth="70" className="hero-card absolute z-20 left-0 top-[24%] sm:top-[130px] w-[62%] sm:w-[300px] drop-shadow-[0_24px_36px_rgba(17,17,17,0.2)]">
              <Image
                src="/assets/hero_image_2.png"
                alt="Girl taking selfie"
                width={302}
                height={372}
                className="w-full h-auto"
                priority
              />
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
