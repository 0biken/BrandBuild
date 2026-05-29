"use client";

import Image from "next/image";
import Link from "next/link";
import { WaitlistForm } from "./WaitlistForm";

export function Footer() {
  return (
    <>
      {/* Footer CTA Section */}
      <section id="waitlist" className="relative py-24 lg:py-[160px] flex items-center justify-center overflow-hidden border-y-2 border-brand-black">
        <div className="absolute inset-0 z-0">
          <Image
            src="/assets/footer_image.png"
            alt=""
            fill
            className="object-cover"
            sizes="100vw"
            priority={false}
          />
        </div>
        <div className="absolute inset-0 bg-black/50 z-0" />
        
        <div className="relative z-10 max-w-[1440px] mx-auto px-6 lg:px-20 w-full flex flex-col items-center text-center">
          <h2 className="font-display font-black text-[32px] sm:text-[48px] lg:text-[64px] leading-[1.05] text-white mb-10 max-w-[800px] shadow-sm">
            Build with us and level up your business
          </h2>
          
          <div className="w-full max-w-[480px]">
            <WaitlistForm isFooter={true} />
          </div>
        </div>
      </section>

      {/* Main Footer */}
      <footer className="bg-brand-black pt-20 overflow-hidden relative">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-20 relative z-10">
          
          <div className="flex flex-col lg:flex-row justify-between gap-16 mb-20">
            {/* Links Columns */}
            <div className="flex flex-col gap-4 w-full max-w-[400px]">
              <h4 className="font-display font-bold text-[20px] text-white">
                Contact Us
              </h4>
              <a href="mailto:hello@brandbuild.com" className="font-body text-[16px] text-white/80 hover:text-white transition-colors">
                hello@brandbuild.com
              </a>
            </div>

            {/* Social / Legal Column */}
            <div className="flex flex-col items-start lg:items-end min-w-[200px]">
              <div className="flex flex-wrap gap-4 mb-12">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <a key={num} href="#" className="opacity-60 hover:opacity-100 transition-opacity">
                    <Image src={`/assets/social-${num}.png`} alt={`Social ${num}`} width={24} height={24} />
                  </a>
                ))}
              </div>

              <div className="flex flex-col lg:items-end gap-2 text-left lg:text-right">
                <span className="font-body text-[13px] text-white/40">
                  © 2026 BrandBuild.
                </span>
                <a href="/privacy-policy" className="font-body text-[13px] text-white/40 hover:text-white transition-colors">
                  Privacy Policy
                </a>
                <a href="/terms" className="font-body text-[13px] text-white/40 hover:text-white transition-colors">
                  Terms of Service
                </a>
              </div>
            </div>
          </div>

        </div>

        {/* Massive BrandBuild Background Text */}
        <div className="w-full flex justify-center translate-y-[20%] select-none pointer-events-none relative z-0 mt-8 border-t border-white/5 pt-8">
          <span className="font-display font-black text-[12vw] leading-none text-[#119e48] whitespace-nowrap tracking-tighter">
            BrandBuild
          </span>
        </div>

      </footer>
    </>
  );
}
