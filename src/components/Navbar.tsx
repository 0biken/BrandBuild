"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close on Escape and lock page scroll while the mobile menu is open
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const navLinks = [
    { name: "How It Works", href: "#how-it-works" },
    { name: "Features", href: "#brands" },
    { name: "FAQ", href: "#faq" },
  ];

  return (
    <>
      <nav className="fixed top-6 left-0 right-0 z-[100] flex justify-center px-4">
        {/* Pill shaped navbar container */}
        <div className="relative flex items-center justify-between px-6 py-2 rounded-full shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-black/5 bg-white/95 backdrop-blur-md w-full max-w-[800px]">
          
          <Link href="/" className="flex items-center gap-3">
            <Image 
              src="/assets/navbarlogo.svg" 
              alt="Brandbuild Logo" 
              width={24} 
              height={24} 
              className="h-6 w-auto" 
            />
          </Link>

          <div className="hidden md:flex items-center gap-8 mx-auto">
            {navLinks.map((link) => (
              <Link 
                key={link.name} 
                href={link.href}
                className="font-body font-medium text-[14px] text-brand-black hover:text-brand-green transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </div>

          <div className="hidden md:block">
            <a href="https://docs.google.com/forms/d/1rsoSzN4C5JzlHdBaZkEPtP_MAm2cshrcp5icvFeobbw/viewform" target="_blank" rel="noopener noreferrer" className="btn-primary !px-5 !py-2.5 !text-[13px]">
              Join the Waitlist
            </a>
          </div>

          <button 
            className="md:hidden p-2 text-brand-black"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </nav>

      {/* Mobile Menu Drawer: stays mounted so it can animate out */}
      <div
        id="mobile-menu"
        inert={!isMobileMenuOpen}
        className={`fixed inset-0 z-[200] bg-white text-brand-black flex flex-col md:hidden transition-[opacity,transform,visibility] ease-[var(--ease-out)] ${
          isMobileMenuOpen
            ? "visible opacity-100 translate-y-0 duration-200"
            : "invisible opacity-0 -translate-y-2 pointer-events-none duration-150"
        }`}
      >
          <div className="flex justify-end p-6">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2"
              aria-label="Close menu"
            >
              <X size={32} />
            </button>
          </div>
          
          <div className="flex flex-col gap-8 px-8 pt-12 text-center">
            {navLinks.map((link) => (
              <Link 
                key={link.name}
                href={link.href}
                className="font-display font-bold text-3xl"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.name}
              </Link>
            ))}
            <a href="https://docs.google.com/forms/d/1rsoSzN4C5JzlHdBaZkEPtP_MAm2cshrcp5icvFeobbw/viewform" target="_blank" rel="noopener noreferrer" onClick={() => setIsMobileMenuOpen(false)} className="btn-primary mt-4 mx-auto text-lg w-full max-w-sm">
              Join the Waitlist
            </a>
          </div>
      </div>
    </>
  );
}
