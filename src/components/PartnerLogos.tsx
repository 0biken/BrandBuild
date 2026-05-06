"use client";

import Image from "next/image";

const LOGOS = [
  { name: "AMD", src: "/assets/amd_logo.svg" },
  { name: "Coursera", src: "/assets/coursera_logo.svg" },
  { name: "Amazon", src: "/assets/amazon_logo.svg" },
  { name: "Cognizant", src: "/assets/cognizant_logo.svg" },
];

export function PartnerLogos() {
  return (
    <section className="bg-brand-green py-6 border-y-2 border-brand-black overflow-hidden relative z-20 flex">
      {/* Container that animates */}
      <div className="flex w-max animate-marquee gap-8 lg:gap-16 items-center px-4">
        {/* We map twice to create a seamless scrolling loop */}
        {[...LOGOS, ...LOGOS, ...LOGOS, ...LOGOS].map((logo, i) => (
          <div key={i} className="flex items-center gap-8 lg:gap-16 shrink-0">
            {/* Logo image and text */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 relative invert opacity-90 flex items-center justify-center">
                <Image src={logo.src} alt={logo.name} fill className="object-contain" />
              </div>
              <span className="font-display font-black text-white text-xl lg:text-3xl tracking-wide">
                {logo.name}
              </span>
            </div>
            
            {/* Chevron separator */}
            <div className="text-brand-black opacity-80 shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
