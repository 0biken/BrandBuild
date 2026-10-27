import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { FinalCta } from "@/components/landing/FinalCta";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Marquee } from "@/components/landing/Marquee";
import { Students } from "@/components/landing/Students";
import { TrustStack } from "@/components/landing/TrustStack";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Marquee />
      <HowItWorks />
      <Features />
      <TrustStack />
      <Students />
      <Faq />
      <FinalCta />
    </>
  );
}
