"use client";

import { useState } from "react";

const FAQS = [
  {
    question: "What is Brandbuild?",
    answer: "Brandbuild is an AI-powered social media management platform built specifically for small and medium businesses. It brings content creation, scheduling, analytics, and a unified inbox into one simple dashboard."
  },
  {
    question: "Which social platforms do you support?",
    answer: "We support Instagram, TikTok, Facebook, X (Twitter), LinkedIn, and Pinterest at launch. YouTube Shorts and Threads support will be added shortly after."
  },
  {
    question: "How does the AI content generation work?",
    answer: "Our AI learns your brand voice, audience, and past performance to generate captions, hashtags, and visual suggestions tailored to each platform. You review, tweak if needed, and publish — all in minutes."
  },
  {
    question: "When do you launch?",
    answer: "We are currently in private beta and will open the platform to our waitlist in batches. Joining the waitlist early ensures you are in the first wave of invites."
  }
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (i: number) => {
    setOpenIndex(openIndex === i ? null : i);
  };

  return (
    <section id="faq" className="bg-wavy-pattern py-20 lg:py-[100px]">
      <div className="max-w-[800px] mx-auto px-6 lg:px-20">
        <h2 className="font-display font-black text-[32px] sm:text-[48px] text-brand-black mb-12 text-center">
          Got questions?
        </h2>
        
        <div className="flex flex-col gap-4">
          {FAQS.map((faq, i) => (
            <div 
              key={i} 
              className="bg-white border-2 border-brand-black rounded-[16px] shadow-sm overflow-hidden"
            >
              <button 
                onClick={() => toggle(i)}
                className="w-full px-6 py-5 flex items-center justify-between text-left focus:outline-none hover:bg-gray-50 transition-colors"
              >
                <span className="font-display font-bold text-[18px] text-brand-black pr-4">
                  {faq.question}
                </span>
                <div className="flex-shrink-0 text-brand-green">
                  {openIndex === i ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  )}
                </div>
              </button>
              
              <div 
                className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${openIndex === i ? 'max-h-[200px] pb-5 opacity-100' : 'max-h-0 opacity-0'}`}
              >
                <p className="font-body text-[16px] text-brand-black/70">
                  {faq.answer}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
