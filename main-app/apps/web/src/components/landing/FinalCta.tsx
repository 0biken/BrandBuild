import { ButtonLink } from "@/components/ui/Button";

/** Action: high-contrast closing CTA that flows straight into the footer. */
export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden bg-forest px-6 pt-32 pb-24 text-center md:px-12 md:pt-48">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 size-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/35 blur-[140px]" />
        <div className="absolute -right-40 bottom-0 size-[520px] rounded-full bg-lime/15 blur-[120px]" />
      </div>
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-10">
        <h2 className="m-0 font-sans text-[clamp(3rem,7vw,6.5rem)] leading-[0.96] font-semibold tracking-[-0.05em] text-white">
          Your next post is one line away.
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/signup" variant="lime" size="lg" className="rounded-full">
            Start free
          </ButtonLink>
          <ButtonLink href="/pricing" variant="outline" size="lg" className="rounded-full">
            See pricing
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
