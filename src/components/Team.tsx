"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function Team() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const TEAM = [
    { name: "Obioma", role: "CEO, KARMA GROUPS", image: "/assets/hero_image_1.png", linkedin: "#" },
    { name: "Anu", role: "CEO, BrandBuilds", image: "/assets/hero_image_2.png", linkedin: "#" },
    { name: "Miss X", role: "Lead UI/UX", image: "/assets/hero_image_1.png", linkedin: "#" },
  ];

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      if (contentRef.current) {
        gsap.fromTo(
          contentRef.current.children,
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            stagger: 0.2,
            ease: "power3.out",
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
    <section ref={sectionRef} className="bg-wavy-pattern py-20 lg:py-[100px] border-y-2 border-brand-black">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 text-center">
        
        <h2 className="font-display font-black text-[32px] sm:text-[48px] text-brand-black mb-4">
          Meet the Team
        </h2>
        <p className="font-body text-[18px] text-brand-black/70 mb-16 max-w-[600px] mx-auto">
          We're a team of creators, strategists, and technologists building the platform we always wished we had.
        </p>

        <div ref={contentRef} className="flex flex-wrap justify-center gap-8">
          {TEAM.map((member, i) => (
            <div key={i} className="flex flex-col items-center w-[250px]">
              <div className="relative w-full aspect-square rounded-[24px] overflow-hidden border-2 border-brand-black shadow-brutalist mb-6 bg-gray-200">
                <Image src={member.image} alt={member.name} fill className="object-cover" />
              </div>
              <h3 className="font-display font-bold text-[24px] text-brand-black mb-1">
                {member.name}
              </h3>
              <p className="font-body text-[14px] text-brand-black/70 mb-3">
                {member.role}
              </p>
              <a href={member.linkedin} target="_blank" rel="noopener noreferrer" className="text-brand-green hover:text-brand-green-hover transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                </svg>
              </a>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
