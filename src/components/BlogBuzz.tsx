"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const BLOGS = [
  {
    image: "/assets/blog_image_1.png",
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

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".blog-header",
        { opacity: 0, y: 30 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 80%",
          }
        }
      );

      if (gridRef.current) {
        gsap.fromTo(
          gridRef.current.children,
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            stagger: 0.15,
            ease: "power3.out",
            scrollTrigger: {
              trigger: gridRef.current,
              start: "top 80%",
            }
          }
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="bg-[#fcfcfc] py-20 lg:py-[100px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20">
        
        <h2 className="blog-header font-display font-black text-[40px] text-brand-black mb-12 text-center">
          Keep up with the latest buzz.
        </h2>

        <div ref={gridRef} className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-[1000px] mx-auto">
          
          {/* Main Large Blog Card */}
          <Link 
            href="#"
            className="group relative h-full min-h-[400px] flex flex-col md:row-span-2"
          >
            <div className="absolute inset-0 bg-brand-black rounded-[24px] translate-x-[8px] translate-y-[8px]" />
            <div className="relative bg-brand-green rounded-[24px] border-2 border-brand-black p-8 flex flex-col h-full transition-transform hover:-translate-y-1 hover:-translate-x-1 duration-200">
              
              <div className="mb-6 flex gap-2">
                <span className="font-body text-[12px] font-bold text-brand-green bg-white px-3 py-1 rounded-full border border-black uppercase tracking-wide">
                  {BLOGS[0].label}
                </span>
              </div>

              <div className="relative w-full aspect-square mb-6 rounded-xl overflow-hidden border-2 border-black">
                <Image src={BLOGS[0].image} alt="" fill className="object-cover" />
              </div>

              <h3 className="font-display font-bold text-[24px] text-white leading-tight mt-auto">
                {BLOGS[0].title}
              </h3>
            </div>
          </Link>

          {/* Secondary Stacked Blog Cards */}
          <div className="flex flex-col gap-8">
            {BLOGS.slice(1).map((blog, i) => (
              <Link 
                key={i} 
                href="#"
                className="group relative w-full h-[200px]"
              >
                <div className="absolute inset-0 bg-brand-black rounded-[24px] translate-x-[8px] translate-y-[8px]" />
                <div className="relative bg-brand-green rounded-[24px] border-2 border-brand-black p-6 flex items-center gap-6 h-full transition-transform hover:-translate-y-1 hover:-translate-x-1 duration-200">
                  
                  <div className="flex-1 flex flex-col">
                    <div className="mb-4">
                      <span className="font-body text-[11px] font-bold text-brand-green bg-white px-3 py-1 rounded-full border border-black uppercase tracking-wide">
                        {blog.label}
                      </span>
                    </div>
                    <h3 className="font-display font-bold text-[18px] text-white leading-tight">
                      {blog.title}
                    </h3>
                  </div>

                  <div className="relative w-[120px] h-[120px] rounded-xl overflow-hidden border-2 border-black shrink-0">
                    <Image src={blog.image} alt="" fill className="object-cover" />
                  </div>

                </div>
              </Link>
            ))}
          </div>

        </div>

      </div>
    </section>
  );
}
