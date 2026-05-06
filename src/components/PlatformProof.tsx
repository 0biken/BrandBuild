"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function PlatformProof() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      // Fade up section text
      gsap.fromTo(
        ".platform-header > *",
        { opacity: 0, x: -30 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 70%",
          }
        }
      );

      // Slide up widgets
      if (cardsRef.current) {
        gsap.fromTo(
          cardsRef.current.children,
          { opacity: 0, y: 50 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            stagger: 0.2,
            ease: "power3.out",
            scrollTrigger: {
              trigger: cardsRef.current,
              start: "top 70%",
            }
          }
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="bg-wavy-pattern flex flex-col lg:flex-row min-h-[600px] border-y-2 border-brand-black relative">
      
      {/* Left Side (White) */}
      <div className="flex-1 px-6 py-20 lg:py-32 lg:px-20 flex flex-col justify-center items-start border-b-2 lg:border-b-0 lg:border-r-2 border-brand-black bg-[#fcfcfc]">
        <div className="platform-header max-w-[500px]">
          <h2 className="font-display font-black text-[48px] leading-[1.05] tracking-tight text-brand-black mb-6">
            Other brands are guessing. <br />
            You don't have to.
          </h2>
          <p className="font-body text-[18px] text-brand-black/70 mb-8 leading-[1.6]">
            Our platform tracks what creators actually sell — not just what they post. See exact ROI on every campaign you run with confidence.
          </p>
          <Link href="#waitlist" className="font-body font-bold text-brand-green underline underline-offset-4 decoration-2 hover:text-brand-green-hover text-[16px]">
            Learn More →
          </Link>
        </div>
      </div>

      {/* Right Side (Green) */}
      <div className="flex-1 bg-[#12582b] relative overflow-hidden flex items-center justify-center p-6 py-20 lg:py-0">
        <div ref={cardsRef} className="relative w-full h-[500px] max-w-[600px]">
          
          {/* Mockup Widget 1 */}
          <div className="absolute top-[10%] right-[10%] bg-white rounded-[16px] shadow-brutalist border-2 border-black p-4 px-6 flex items-center justify-center z-10 w-fit">
             <span className="font-display font-black text-[32px] text-brand-black">500M+</span>
          </div>

          {/* Mockup Widget 2 */}
          <div className="absolute top-[35%] right-[5%] bg-white rounded-[16px] shadow-brutalist border-2 border-black p-4 px-6 flex items-center justify-center z-20 w-fit">
             <span className="font-display font-black text-[32px] text-brand-black">$200+</span>
          </div>

           {/* Mockup Widget 3 */}
          <div className="absolute top-[25%] left-[5%] bg-white rounded-[16px] shadow-brutalist border-2 border-black p-4 flex flex-col z-30 w-[240px]">
             <div className="flex items-center gap-3 mb-2">
               <div className="w-10 h-10 bg-gray-200 rounded-full" />
               <div className="flex flex-col">
                 <span className="font-display font-bold text-[14px]">Gia Johnson</span>
                 <span className="font-body text-[12px] text-brand-green">15x Content ROI</span>
               </div>
             </div>
             <div className="w-full h-2 bg-gray-100 rounded-full mt-2">
               <div className="w-[85%] h-full bg-brand-green rounded-full" />
             </div>
          </div>

          {/* Additional abstract shapes can be added here based on mockup */}
        </div>
      </div>

    </section>
  );
}
