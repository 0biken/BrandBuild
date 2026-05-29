"use client";

import { useState } from "react";
import Image from "next/image";

export function WaitlistForm({ isFooter = false }: { isFooter?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [waitlistData, setWaitlistData] = useState<{ position: number, referralId: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setStatus("error");
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "Something went wrong.");
        return;
      }
      
      setWaitlistData({ position: data.position, referralId: data.referralId });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMessage("Network error. Please try again.");
    }
  };

  return (
    <div className={`max-w-[480px] mx-auto w-full ${!isFooter ? 'bg-white p-8 rounded-[20px] shadow-sm border border-black/5' : ''}`}>
      
      {status === "success" && waitlistData ? (
        <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 rounded-full bg-[#2DBF6E]/10 flex items-center justify-center mb-4">
            <Image src="/assets/checkmark.svg" alt="Success" width={32} height={32} />
          </div>
          <h3 className="font-display font-bold text-2xl text-brand-black mb-2">You're on the list!</h3>
          <p className="font-body text-[#555] mb-4">You're #{waitlistData.position} in line.</p>
          
          <div className="bg-[#F5F5F5] border border-black/10 rounded-xl p-4 w-full flex flex-col gap-2">
            <span className="font-display font-bold text-[14px]">Skip 10 spots for every referral!</span>
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                readOnly 
                value={`brandbuild.co/waitlist?ref=${waitlistData.referralId}`} 
                className="w-full bg-white border border-black/10 rounded-md px-3 py-2 text-[13px] font-body text-gray-600 outline-none"
              />
              <button 
                className="bg-brand-black text-white px-4 py-2 rounded-md text-[13px] font-bold hover:bg-brand-black/80 transition-colors whitespace-nowrap"
                onClick={() => navigator.clipboard.writeText(`brandbuild.co/waitlist?ref=${waitlistData.referralId}`)}
              >
                Copy
              </button>
            </div>
          </div>
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
