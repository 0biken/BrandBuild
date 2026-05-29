"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export function DualAudience() {
  const [activeTab, setActiveTab] = useState<"business" | "creator">("business");

  return (
    <section className="bg-[#fcfcfc] py-20 lg:py-[100px] relative z-10 border-y-2 border-brand-black">
      <div className="max-w-[1000px] mx-auto px-6 lg:px-20 flex flex-col items-center">
        
        <h2 className="font-display font-black text-[32px] sm:text-[48px] text-brand-black mb-8 text-center">
          Built for growth. <br className="sm:hidden" />
          <span className="text-brand-green">On both sides.</span>
        </h2>

        {/* Toggle Switch */}
        <div className="flex items-center bg-gray-100 p-1 rounded-full border border-black/10 mb-12">
          <button
            onClick={() => setActiveTab("business")}
            className={`px-6 py-3 rounded-full font-display font-bold text-[16px] transition-all ${
              activeTab === "business" 
                ? "bg-white text-brand-black shadow-sm" 
                : "text-brand-black/50 hover:text-brand-black"
            }`}
          >
            For Small Businesses
          </button>
          <button
            onClick={() => setActiveTab("creator")}
            className={`px-6 py-3 rounded-full font-display font-bold text-[16px] transition-all ${
              activeTab === "creator" 
                ? "bg-brand-green text-white shadow-sm" 
                : "text-brand-black/50 hover:text-brand-black"
            }`}
          >
            For Creators
          </button>
        </div>

        {/* Content Area */}
        <div className="w-full relative min-h-[300px]">
          {activeTab === "business" ? (
            <div className="flex flex-col md:flex-row gap-8 items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex-1">
                <h3 className="font-display font-bold text-[28px] mb-4">
                  Find creators who actually sell.
                </h3>
                <p className="font-body text-[16px] text-brand-black/70 mb-6">
                  Stop throwing money at vanity metrics. We match you with creators proven to drive conversions for businesses like yours.
                </p>
                <div className="bg-[#FDE8D4] p-6 rounded-[20px] border-2 border-brand-black shadow-brutalist mb-6">
                  <h4 className="font-bold text-[14px] uppercase tracking-wider mb-2">Waitlist Perks</h4>
                  <ul className="flex flex-col gap-2 font-medium">
                    <li className="flex items-center gap-2">✓ First month free</li>
                    <li className="flex items-center gap-2">✓ No platform fees for 90 days</li>
                  </ul>
                </div>
                <Link href="#waitlist" className="btn-primary inline-flex">Join the Waitlist</Link>
              </div>
              <div className="flex-1 w-full flex justify-center">
                <div className="w-full max-w-[300px] aspect-square relative rounded-[30px] overflow-hidden bg-brand-green border-4 border-brand-black shadow-brutalist">
                  <Image src="/assets/hero_image_1.png" alt="Small Business" fill className="object-cover opacity-80" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-8 items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex-1">
                <h3 className="font-display font-bold text-[28px] mb-4">
                  Get paid what you're worth.
                </h3>
                <p className="font-body text-[16px] text-brand-black/70 mb-6">
                  Connect with emerging brands that respect your time and pay on time. No more chasing net-90 invoices.
                </p>
                <div className="bg-[#E3E6F3] p-6 rounded-[20px] border-2 border-brand-black shadow-brutalist mb-6">
                  <h4 className="font-bold text-[14px] uppercase tracking-wider mb-2">Waitlist Perks</h4>
                  <ul className="flex flex-col gap-2 font-medium">
                    <li className="flex items-center gap-2">✓ Priority profile badge</li>
                    <li className="flex items-center gap-2">✓ Direct brand inbox access</li>
                  </ul>
                </div>
                <Link href="#waitlist" className="btn-primary inline-flex">Join the Waitlist</Link>
              </div>
              <div className="flex-1 w-full flex justify-center">
                <div className="w-full max-w-[300px] aspect-square relative rounded-[30px] overflow-hidden bg-brand-black border-4 border-brand-black shadow-brutalist">
                  <Image src="/assets/hero_image_2.png" alt="Creator" fill className="object-cover opacity-80" />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
