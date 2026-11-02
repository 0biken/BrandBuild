import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#students", label: "For students" },
];

/** Floating glass pill. Links collapse on phones, matching the design. */
export function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="flex w-full max-w-[1100px] items-center gap-6 rounded-full border border-white/60 bg-white/70 py-2 pr-2 pl-5 shadow-[0_10px_40px_-18px_rgba(15,26,19,0.35)] backdrop-blur-xl">
        <Logo />
        <nav aria-label="Site" className="ml-4 flex gap-1 max-md:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-2 text-[15px] text-ink-2 no-underline transition-colors duration-150 fine:bg-white fine:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ButtonLink href="/login" variant="ghost" className="rounded-full max-md:hidden">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" className="rounded-full">
            Start free
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
