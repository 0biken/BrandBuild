"use client";

import { useEffect, type RefObject } from "react";
import gsap from "gsap";

// Pointer-driven 3D tilt. The element rotates toward the cursor and springs back on leave.
// Only runs for fine pointers (mouse/trackpad) without reduced motion.
export function useTilt<T extends HTMLElement>(ref: RefObject<T | null>, maxDeg = 8) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canTilt = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
    if (!canTilt) return;

    gsap.set(el, { transformPerspective: 1000, transformStyle: "preserve-3d" });
    const rotX = gsap.quickTo(el, "rotationX", { duration: 0.6, ease: "power3.out" });
    const rotY = gsap.quickTo(el, "rotationY", { duration: 0.6, ease: "power3.out" });

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rotY(px * maxDeg * 2);
      rotX(-py * maxDeg * 2);
    };
    const onLeave = () => {
      rotX(0);
      rotY(0);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      gsap.set(el, { clearProps: "transform" });
    };
  }, [ref, maxDeg]);
}
