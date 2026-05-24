"use client";

import Image from "next/image";

export function Programs() {
  return (
    <section id="how-it-works" className="bg-brand-green py-20 lg:py-[100px] relative z-10 -mt-1 pt-[80px]">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-20 text-center flex flex-col items-center">
        
        <h2 className="font-display font-black text-[40px] lg:text-[56px] text-white mb-2">
          Go big! We've got you.
        </h2>
        <p className="font-body text-[18px] text-white/90 mb-12">
          Resources to scale your growth with BrandBuild!
        </p>

        {/* Outer White Card Container */}
        <div className="w-full bg-[#fcfcfc] rounded-[32px] p-8 lg:p-12 shadow-brutalist border border-black text-left flex flex-col">
          
          {/* Top Tabs (Simulated) */}
          <div className="flex flex-wrap gap-4 mb-10 pb-4 border-b border-black/10">
            <span className="font-body font-bold text-brand-green border-b-2 border-brand-green pb-1 px-2 cursor-pointer">
              Creator Matching
            </span>
            <span className="font-body font-medium text-brand-midgray hover:text-brand-black px-2 cursor-pointer transition-colors">
              Campaign Strategy
            </span>
            <span className="font-body font-medium text-brand-midgray hover:text-brand-black px-2 cursor-pointer transition-colors">
              Performance Tracking
            </span>
          </div>

          <div className="flex flex-col lg:flex-row gap-12">
            
            {/* Left Copy Area */}
            <div className="flex-1 flex flex-col justify-center">
              <h3 className="font-display font-black text-[32px] text-brand-black mb-4">
                Full-service programs.
              </h3>
              <p className="font-body text-[16px] text-brand-black/70 mb-8 max-w-[400px]">
                We match you with the right creators for your brand category.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 mb-8">
                {[
                  "Verified Influencers",
                  "Performance Driven",
                  "Guaranteed Safety",
                  "Transparent Analytics"
                ].map((feature, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-green flex items-center justify-center text-white">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <span className="font-body text-[14px] font-medium text-brand-black">{feature}</span>
                  </div>
                ))}
              </div>

              <a href="#" className="font-body font-bold text-brand-green underline underline-offset-4 decoration-2 hover:text-brand-green-hover w-fit">
                Learn More →
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
