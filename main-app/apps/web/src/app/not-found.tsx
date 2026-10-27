import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col gap-10 bg-page px-14 pt-8 max-md:px-4 max-md:pt-6">
      <Logo />
      <div className="flex max-w-[520px] flex-col items-start gap-4 pt-8">
        <p className="m-0 font-mono text-sm text-muted">404</p>
        <h1 className="m-0 font-display text-[44px] leading-none font-bold tracking-[-0.04em]">
          We couldn&apos;t find that page.
        </h1>
        <p className="m-0 text-[17px] text-ink-2">
          The link may be old or mistyped. Nothing was lost.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <ButtonLink href="/" size="lg">Back to home</ButtonLink>
          <ButtonLink href="/login" variant="outline" size="lg">Log in</ButtonLink>
        </div>
      </div>
    </main>
  );
}
