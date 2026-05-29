import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Programs } from "@/components/Programs";
import { Stats } from "@/components/Stats";
import { DualAudience } from "@/components/DualAudience";
import { PlatformProof } from "@/components/PlatformProof";
import { ExpertGallery } from "@/components/ExpertGallery";
import { CaseStudies } from "@/components/CaseStudies";
import { Testimonial } from "@/components/Testimonial";
import { Team } from "@/components/Team";
import { BlogBuzz } from "@/components/BlogBuzz";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col w-full selection:bg-brand-green/30 selection:text-brand-black">
      <Navbar />
      
      <Hero />
      <Programs />
      <Stats />
      <DualAudience />
      <PlatformProof />
      <ExpertGallery />
      <CaseStudies />
      <Testimonial />
      <Team />
      <BlogBuzz />
      <FAQ />
      
      <Footer />
    </main>
  );
}
