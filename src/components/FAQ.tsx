"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

const FAQS = [
  {
    question: "What is Brandbuild?",
    answer: "Brandbuild is a social media management platform built specifically for small and medium businesses. It brings content creation, scheduling, analytics, and a unified inbox into one simple dashboard — so you can stop juggling five different tools."
  },
  {
    question: "Which social platforms do you support?",
    answer: "We support Instagram, TikTok, Facebook, X (Twitter), LinkedIn, and Pinterest at launch. YouTube Shorts and Threads support will be added shortly after."
  },
  {
    question: "How does content creation work?",
    answer: "Tell us about your brand and what you want to say. Brandbuild generates on-brand captions, hashtags, and visual suggestions tailored to each platform. You review, tweak if needed, and publish — all in minutes."
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
                aria-expanded={openIndex === i}
                aria-controls={`faq-answer-${i}`}
                className="w-full px-6 py-5 flex items-center justify-between text-left rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-green hover:bg-gray-50 transition-colors"
              >
                <span className="font-display font-bold text-[18px] text-brand-black pr-4">
                  {faq.question}
                </span>
                <Plus
                  size={24}
                  strokeWidth={3}
                  aria-hidden="true"
                  className={`flex-shrink-0 text-brand-green transition-transform duration-200 ease-[var(--ease-out)] ${openIndex === i ? "rotate-45" : ""}`}
                />
              </button>

              {/* grid-rows 0fr -> 1fr animates to the answer's real height */}
              <div
                id={`faq-answer-${i}`}
                className={`grid transition-[grid-template-rows,opacity] duration-[250ms] ease-[var(--ease-out)] ${openIndex === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
              >
                <div className="min-h-0 overflow-hidden">
                  <p className="px-6 pb-5 font-body text-[16px] text-brand-black/70">
                    {faq.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
