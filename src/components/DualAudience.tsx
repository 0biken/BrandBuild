"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export function DualAudience() {
  const [activeTab, setActiveTab] = useState<"solo" | "team">("solo");

  return (
    <section className="bg-[#fcfcfc] py-20 lg:py-[100px] relative z-10 border-y-2 border-brand-black">
      <div className="max-w-[1000px] mx-auto px-6 lg:px-20 flex flex-col items-center">
        
        <h2 className="font-display font-black text-[32px] sm:text-[48px] text-brand-black mb-8 text-center">
          Built for you. <br className="sm:hidden" />
          <span className="text-brand-green">However you grow.</span>
        </h2>

        {/* Toggle Switch */}
        <div className="flex items-center bg-gray-100 p-1 rounded-full border border-black/10 mb-12">
          <button
            onClick={() => setActiveTab("solo")}
            className={`px-6 py-3 rounded-full font-display font-bold text-[16px] transition-all ${
              activeTab === "solo" 
                ? "bg-white text-brand-black shadow-sm" 
                : "text-brand-black/50 hover:text-brand-black"
            }`}
          >
            For Solo Founders
          </button>
          <button
            onClick={() => setActiveTab("team")}
            className={`px-6 py-3 rounded-full font-display font-bold text-[16px] transition-all ${
              activeTab === "team" 
                ? "bg-brand-green text-white shadow-sm" 
                : "text-brand-black/50 hover:text-brand-black"
            }`}
          >
            For Growing Teams
          </button>
        </div>

        {/* Content Area */}
        <div className="w-full relative min-h-[300px]">
          {activeTab === "solo" ? (
            <div className="flex flex-col md:flex-row gap-8 items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex-1">
                <h3 className="font-display font-bold text-[28px] mb-4">
                  Time is your most valuable asset.
                </h3>
                <p className="font-body text-[16px] text-brand-black/70 mb-6">
                  Let our AI do the heavy lifting. Generate posts, schedule weeks ahead, and manage every platform from a single dashboard — so you can focus on running your business.
                </p>
                <div className="bg-[#FDE8D4] p-6 rounded-[20px] border-2 border-brand-black shadow-brutalist mb-6">
                  <h4 className="font-bold text-[14px] uppercase tracking-wider mb-2">What You Get</h4>
                  <ul className="flex flex-col gap-2 font-medium">
                    <li className="flex items-center gap-2">✓ AI Content Generation</li>
                    <li className="flex items-center gap-2">✓ Auto-Scheduling Calendar</li>
                    <li className="flex items-center gap-2">✓ Unified Priority Inbox</li>
                  </ul>
                </div>
                <a href="https://docs.google.com/forms/d/1rsoSzN4C5JzlHdBaZkEPtP_MAm2cshrcp5icvFeobbw/viewform" target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex">Join the Waitlist</a>
              </div>
              <div className="flex-1 w-full flex justify-center">
                <div className="w-full max-w-[300px] aspect-square relative rounded-[30px] overflow-hidden bg-brand-green border-4 border-brand-black shadow-brutalist">
                  <Image src="/assets/hero_image_1.png" alt="Solo Founder" fill className="object-cover opacity-80" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-8 items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex-1">
                <h3 className="font-display font-bold text-[28px] mb-4">
                  Scale without the chaos.
                </h3>
                <p className="font-body text-[16px] text-brand-black/70 mb-6">
                  Collaborate, approve, and analyze performance seamlessly. Give your team the tools to manage multiple accounts without stepping on each other's toes.
                </p>
                <div className="bg-[#E3E6F3] p-6 rounded-[20px] border-2 border-brand-black shadow-brutalist mb-6">
                  <h4 className="font-bold text-[14px] uppercase tracking-wider mb-2">What You Get</h4>
                  <ul className="flex flex-col gap-2 font-medium">
                    <li className="flex items-center gap-2">✓ Collaborative Workspaces</li>
                    <li className="flex items-center gap-2">✓ Custom Approval Workflows</li>
                    <li className="flex items-center gap-2">✓ Advanced Client Reporting</li>
                  </ul>
                </div>
                <a href="https://docs.google.com/forms/d/1rsoSzN4C5JzlHdBaZkEPtP_MAm2cshrcp5icvFeobbw/viewform" target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex">Join the Waitlist</a>
              </div>
              <div className="flex-1 w-full flex justify-center">
                <div className="w-full max-w-[300px] aspect-square relative rounded-[30px] overflow-hidden bg-brand-black border-4 border-brand-black shadow-brutalist">
                  <Image src="/assets/hero_image_2.png" alt="Growing Team" fill className="object-cover opacity-80" />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
