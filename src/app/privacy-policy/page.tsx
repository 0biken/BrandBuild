import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export default function PrivacyPolicy() {
  return (
    <main className="flex min-h-screen flex-col w-full selection:bg-brand-green/30 selection:text-brand-black">
      <Navbar />
      
      <section className="bg-wavy-pattern pt-40 pb-20 lg:pt-[200px] lg:pb-[100px] flex-1">
        <div className="max-w-[800px] mx-auto px-6 lg:px-20">
          <h1 className="font-display font-black text-[40px] lg:text-[56px] text-brand-black mb-8">
            Privacy Policy
          </h1>
          
          <div className="prose prose-lg font-body text-brand-black/80">
            <p className="font-bold text-[20px] mb-6">
              We believe in keeping things simple and transparent.
            </p>
            
            <h2 className="font-display font-bold text-[24px] text-brand-black mt-8 mb-4">What we collect</h2>
            <p>
              We only collect your email address when you join our waitlist. We use this strictly to send you updates about our launch, new features, and your position in line.
            </p>

            <h2 className="font-display font-bold text-[24px] text-brand-black mt-8 mb-4">What we don't do</h2>
            <p>
              We do not sell, rent, or share your data with any third parties. We don't sell your data to brands, and we don't sell it to creators. Your information stays with us.
            </p>

            <h2 className="font-display font-bold text-[24px] text-brand-black mt-8 mb-4">Contact Us</h2>
            <p>
              If you have any questions about this policy, please reach out to us at <a href="mailto:hello@brandbuild.com" className="text-brand-green font-bold hover:underline">hello@brandbuild.com</a>.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
