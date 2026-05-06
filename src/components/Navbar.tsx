"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import gsap from "gsap";

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const navRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    // Initial entry animation
    if (navRef.current) {
      gsap.fromTo(
        navRef.current,
        { y: -20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.9, delay: 0.3, ease: "power3.out" }
      );
    }

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "How It Works", href: "#how-it-works" },
    { name: "Creators", href: "#creators" },
    { name: "Brands", href: "#brands" },
  ];

  return (
    <>
      <nav
        ref={navRef}
        className="fixed top-6 left-0 right-0 z-[100] flex justify-center px-4"
      >
        {/* Pill shaped navbar container */}
        <div className={`relative flex items-center justify-between px-6 py-2 rounded-full transition-all duration-300 shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-black/5 bg-white/95 backdrop-blur-md w-full max-w-[800px]`}>
          
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
            <Link href="#waitlist" className="btn-primary !px-5 !py-2.5 !text-[13px]">
              Join the Waitlist
            </Link>
          </div>

          <button 
            className="md:hidden p-2 text-brand-black"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </nav>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[200] bg-white text-brand-black flex flex-col">
          <div className="flex justify-end p-6">
            <button 
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2"
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
            <Link href="#waitlist" onClick={() => setIsMobileMenuOpen(false)} className="btn-primary mt-4 mx-auto text-lg w-full max-w-sm">
              Join the Waitlist
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
