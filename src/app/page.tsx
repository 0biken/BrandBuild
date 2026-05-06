import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { PartnerLogos } from "@/components/PartnerLogos";
import { Programs } from "@/components/Programs";
import { Stats } from "@/components/Stats";
import { PlatformProof } from "@/components/PlatformProof";
import { ExpertGallery } from "@/components/ExpertGallery";
import { CaseStudies } from "@/components/CaseStudies";
import { Testimonial } from "@/components/Testimonial";
import { Team } from "@/components/Team";
import { BlogBuzz } from "@/components/BlogBuzz";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col w-full selection:bg-brand-green/30 selection:text-brand-black">
      <Navbar />
      
      <Hero />
      <PartnerLogos />
      <Programs />
      <Stats />
      <PlatformProof />
      <ExpertGallery />
      <CaseStudies />
      <Testimonial />
      <Team />
      <BlogBuzz />
      
      <Footer />
    </main>
  );
}
