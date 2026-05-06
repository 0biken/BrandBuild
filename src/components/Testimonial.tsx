"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function Testimonial() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // Autoplay logic for desktop
    const isMobile = window.innerWidth < 768;
    if (!isMobile && videoRef.current) {
      videoRef.current.play().catch(() => {
        // Handle autoplay policy block
        setIsPlaying(false);
      });
      setIsPlaying(true);
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".testimonial-content > *",
        { opacity: 0, x: 30 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 70%",
          }
        }
      );
      
      gsap.fromTo(
        ".testimonial-video",
        { opacity: 0, scale: 0.95 },
        {
          opacity: 1,
          scale: 1,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 70%",
          }
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <section ref={sectionRef} className="bg-[#111111] py-20 lg:py-[80px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20">
        
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          
          {/* Video Left */}
          <div className="testimonial-video w-full lg:w-[60%] relative group cursor-pointer" onClick={togglePlay}>
            <video
              ref={videoRef}
              muted
              loop
              playsInline
              preload="none"
              poster="/assets/testimonial-poster.jpg" // Placeholder poster
              className="w-full rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.6)] object-cover"
            >
              <source src="/assets/Homepage-Testimonial-1.mp4" type="video/mp4" />
            </video>
            
            {/* Custom Play Button Overlay (visible when paused or mobile) */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl transition-opacity">
                <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30">
                  <div className="w-0 h-0 border-t-8 border-t-transparent border-l-[14px] border-l-white border-b-8 border-b-transparent ml-1" />
                </div>
              </div>
            )}
          </div>

          {/* Quote Right */}
          <div className="testimonial-content w-full lg:w-[40%] flex flex-col relative">
            <span className="font-display font-black text-[80px] leading-none text-[#2DBF6E] opacity-40 absolute -top-8 -left-4 pointer-events-none select-none">
              "
            </span>
            
            <p className="font-body font-light text-[18px] leading-[1.6] text-white/80 mb-8 relative z-10">
              Brandbuild entirely changed how we approach creator partnerships. The revenue tracking showed us exactly what was working, allowing us to double down on top performers and scale our campaigns effortlessly.
            </p>
            
            <div className="flex flex-col">
              <span className="font-body font-medium text-[14px] text-white">Sarah Jenkins</span>
              <span className="font-body text-[14px] text-[#888]">CMO, Acme Beauty</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
