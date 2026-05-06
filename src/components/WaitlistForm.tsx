"use client";

import { useState } from "react";
import Image from "next/image";

export function WaitlistForm({ isFooter = false }: { isFooter?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setStatus("error");
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    // Simulate API Call
    setTimeout(() => {
      setStatus("success");
    }, 1500);
  };

  return (
    <div className={`max-w-[480px] mx-auto w-full ${!isFooter ? 'bg-white p-8 rounded-[20px] shadow-sm border border-black/5' : ''}`}>
      
      {status === "success" ? (
        <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 rounded-full bg-[#2DBF6E]/10 flex items-center justify-center mb-4">
            <Image src="/assets/checkmark.svg" alt="Success" width={32} height={32} />
          </div>
          <h3 className="font-display font-bold text-2xl text-brand-black mb-2">You're on the list!</h3>
          <p className="font-body text-[#555]">You're #47. We'll be in touch soon.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if(status === 'error') setStatus('idle');
              }}
              placeholder="Your work email"
              required
              disabled={status === "loading"}
              className={`w-full h-[52px] px-4 rounded-xl border-[1.5px] bg-[#F5F5F5] font-body text-[15px] outline-none transition-colors
                ${status === "error" ? "border-red-500" : "border-black/10 focus:border-[#2DBF6E]"}
                ${status === "loading" ? "opacity-50 cursor-not-allowed" : ""}
              `}
            />
            {status === "error" && (
              <span className="font-body text-[13px] text-red-500">{errorMessage}</span>
            )}
          </div>
          
          <button 
            type="submit" 
            disabled={status === "loading"}
            className={`btn-primary w-full h-[52px] justify-center ${status === "loading" ? "opacity-80 cursor-wait" : ""}`}
          >
            {status === "loading" ? (
              <div className="w-5 h-5 border-2 border-brand-black/20 border-t-brand-black rounded-full animate-spin" />
            ) : (
              <>
                Join the Waitlist
                <Image src="/assets/arrrow_cta.svg" alt="" width={16} height={16} />
              </>
            )}
          </button>
          
          <p className="font-body text-[12px] text-[#888888] text-center mt-2">
            By joining, you agree to our Privacy Policy.
          </p>
        </form>
      )}

    </div>
  );
}
