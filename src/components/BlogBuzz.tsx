"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTilt } from "./useTilt";

gsap.registerPlugin(ScrollTrigger);

const BLOGS = [
  {
    image: "/assets/blog_event.jpg",
    alt: "Creator recording a video review at a desk with studio lights",
    label: "EVENT",
    title: "Strategic Turning point: 2026 State of Influencer Marketing",
  },
  {
    image: "/assets/blog_image_2.png",
    label: "EVENT",
    title: "Join our upcoming session EP1: Converting cold calls into sales.",
  },
  {
    image: "/assets/blog_image_3.png",
    label: "EVENT",
    title: "Join our upcoming session EP1: Converting cold calls into sales.",
  },
];

export function BlogBuzz() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);

  useTilt(cardRef, 5);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".blog-header",
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 80%",
            once: true,
          }
        }
      );

      if (gridRef.current) {
        gsap.fromTo(
          gridRef.current.children,
          { opacity: 0, y: 16 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.06,
            ease: "power3.out",
            scrollTrigger: {
              trigger: gridRef.current,
              start: "top 80%",
              once: true,
            }
          }
        );
      }

      // Image settles from a slight zoom as the card passes through the viewport
      gsap.fromTo(
        ".blog-img",
        { yPercent: -6, scale: 1.15 },
        {
          yPercent: 6,
          scale: 1.05,
          ease: "none",
          scrollTrigger: { trigger: gridRef.current, start: "top bottom", end: "bottom top", scrub: true },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="bg-[#fcfcfc] py-20 lg:py-[100px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20">
        
        <h2 className="blog-header font-display font-black text-[32px] sm:text-[40px] text-brand-black mb-12 text-center">
          Keep up with the latest buzz.
        </h2>

        <div ref={gridRef} className="flex flex-col items-center gap-8 max-w-[600px] mx-auto w-full">
          
          {/* Main Large Blog Card */}
          <Link 
            ref={cardRef}
            href="#"
            className="group relative w-full min-h-[300px] sm:min-h-[400px] flex flex-col"
          >
            <div className="absolute inset-0 bg-brand-black rounded-[24px] translate-x-[8px] translate-y-[8px]" />
            <div className="relative bg-brand-green rounded-[20px] sm:rounded-[24px] border-2 border-brand-black p-5 sm:p-8 flex flex-col h-full transition-transform hover:-translate-y-1 hover:-translate-x-1 duration-200">
              
              <div className="mb-6 flex gap-2">
                <span className="font-body text-[12px] font-bold text-brand-green bg-white px-3 py-1 rounded-full border border-black uppercase tracking-wide">
                  {BLOGS[0].label}
                </span>
              </div>

              <div className="relative w-full aspect-[16/9] mb-6 rounded-xl overflow-hidden border-2 border-black">
                <Image src={BLOGS[0].image} alt={BLOGS[0].alt ?? ""} fill sizes="(min-width: 640px) 536px, 90vw" className="blog-img object-cover" />
              </div>

              <h3 className="font-display font-bold text-[20px] sm:text-[24px] text-white leading-tight mt-auto">
                {BLOGS[0].title}
              </h3>
            </div>
          </Link>

          {/* CTA Link */}
          <Link href="#" className="btn-primary mt-4">
            See more events
          </Link>

        </div>

      </div>
    </section>
  );
}
