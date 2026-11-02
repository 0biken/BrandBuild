import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Home" };

/** Landing spot after auth until the app shell (Main screen) is built. */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-start gap-6 bg-page px-14 pt-8 max-md:px-4">
      <Logo />
      <div className="flex max-w-[520px] flex-col gap-3 pt-10">
        <h1 className="m-0 font-display text-[40px] leading-tight font-bold tracking-[-0.03em]">
          You&apos;re in.
        </h1>
        <p className="m-0 text-[17px] text-ink-2">
          The Brandbuild app (home, composer and calendar) is the next slice of
          the build.
        </p>
        <ButtonLink href="/" variant="outline" className="mt-2 self-start">
          Back to the site
        </ButtonLink>
      </div>
    </main>
  );
}
