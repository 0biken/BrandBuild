import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/#students", label: "For students" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal#privacy", label: "Privacy policy" },
      { href: "/legal#terms", label: "Terms of service" },
      { href: "/legal#delete", label: "Delete your data" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/legal#contact", label: "Contact us" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-forest px-6 pt-20 pb-10 text-forest-text md:px-12">
      <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-12">
        <div className="flex max-w-xs flex-col gap-4">
          <Logo tone="light" />
          <p className="m-0 text-[15px] text-forest-ink">
            Posts that sound like you, scheduled everywhere you show up.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-16 gap-y-10">
          {COLUMNS.map((c) => (
            <nav key={c.title} aria-label={c.title} className="flex flex-col gap-3">
              <span className="text-sm font-semibold text-white">{c.title}</span>
              {c.links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  className="text-[15px] text-forest-ink no-underline fine:text-white"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-16 flex max-w-[1280px] border-t border-forest-line pt-6 text-sm text-forest-ink">
        &copy; 2026 Brandbuild
      </div>
    </footer>
  );
}
