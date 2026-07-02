"use client";

import Image from "next/image";
import Link from "next/link";

export function Programs() {
  return (
    <section id="how-it-works" className="bg-brand-green py-20 lg:py-[100px] relative z-10 -mt-1 pt-[80px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 text-center flex flex-col items-center">
        
        <h2 className="font-display font-black text-[40px] lg:text-[56px] text-white mb-2">
          Social media management on autopilot.
        </h2>
        <p className="font-body text-[18px] text-white/90 mb-12">
          Everything you need to scale your online presence, seamlessly integrated.
        </p>

        {/* Outer White Card Container */}
        <div className="w-full bg-[#fcfcfc] rounded-[32px] p-8 lg:p-12 shadow-brutalist border border-black text-left flex flex-col">
          
          {/* Top Tabs (Simulated) */}
          <div className="flex flex-wrap gap-4 mb-10 pb-4 border-b border-black/10">
            <span className="font-body font-bold text-brand-green border-b-2 border-brand-green pb-1 px-2 cursor-pointer">
              AI Generation
            </span>
            <span className="font-body font-medium text-brand-midgray hover:text-brand-black px-2 cursor-pointer transition-colors">
              Visual Planner
            </span>
            <span className="font-body font-medium text-brand-midgray hover:text-brand-black px-2 cursor-pointer transition-colors">
              Smart Analytics
            </span>
          </div>

          <div className="flex flex-col lg:flex-row gap-12">
            
            {/* Left Copy Area */}
            <div className="flex-1 flex flex-col justify-center">
              <h3 className="font-display font-black text-[32px] text-brand-black mb-4">
                How It Works
              </h3>
              <p className="font-body text-[16px] text-brand-black/70 mb-8 max-w-[400px]">
                From AI-powered content creation to one-click publishing — your entire social workflow, simplified.
              </p>

              <div className="flex flex-col gap-6 mb-8">
                {[
                  { title: "1. Generate with AI", desc: "Instantly create high-converting captions and visuals tailored to your brand voice." },
                  { title: "2. Schedule visually", desc: "Drag and drop posts onto our intuitive calendar and let us handle the publishing." },
                  { title: "3. Measure & Grow", desc: "Understand your performance with simple, actionable insights that actually make sense." }
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-brand-green flex-shrink-0 flex items-center justify-center text-white mt-1">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-display font-bold text-[18px] text-brand-black">{step.title}</span>
                      <span className="font-body text-[14px] text-brand-black/70">{step.desc}</span>
                    </div>
                  </div>
                ))}
              </div>

              <a href="https://docs.google.com/forms/d/1rsoSzN4C5JzlHdBaZkEPtP_MAm2cshrcp5icvFeobbw/viewform" target="_blank" rel="noopener noreferrer" className="font-body font-bold text-brand-green underline underline-offset-4 decoration-2 hover:text-brand-green-hover w-fit">
                Join the Waitlist →
              </a>
            </div>

            {/* Right Image/Widget Area */}
            <div className="flex-1 relative min-h-[300px] flex items-center justify-center lg:justify-end">
              <div className="relative w-full max-w-[400px] aspect-[4/3] bg-[#f0f0f0] rounded-[24px] overflow-hidden border-2 border-black shadow-brutalist">
                 <Image
                    src="/assets/app_mockup_1.png"
                    alt="App feature"
                    fill
                    className="object-cover"
                 />
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
