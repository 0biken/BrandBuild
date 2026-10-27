import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteNav } from "@/components/site/SiteNav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="w-full max-w-full overflow-x-clip">{children}</main>
      <SiteFooter />
    </>
  );
}
