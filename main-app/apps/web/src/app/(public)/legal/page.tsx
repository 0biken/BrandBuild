import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy, terms and your data",
};

const PROMISES = [
  {
    title: "We never post without you",
    body: "Brandbuild publishes only posts you’ve reviewed and scheduled.",
  },
  {
    title: "Disconnect any time",
    body: "Remove an account in Settings and we stop using its access immediately.",
  },
  {
    title: "Delete everything",
    body: "One button in Settings, or one email. Steps below.",
  },
];

const h2 = "m-0 font-sans text-[clamp(1.75rem,3vw,2.5rem)] leading-tight font-semibold tracking-[-0.035em]";
const h3 = "m-0 text-lg font-semibold";
const p = "m-0 max-w-2xl text-[17px] leading-relaxed text-ink-2";

export default function LegalPage() {
  return (
    <div className="px-6 pt-40 pb-32 md:px-12 md:pt-52 md:pb-48">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-20">
        <header className="flex flex-col gap-5">
          <h1 className="m-0 max-w-5xl font-sans text-[clamp(2.4rem,6.2vw,5.75rem)] leading-[0.98] font-semibold tracking-[-0.045em]">
            Privacy, terms and your data
          </h1>
          <p className="m-0 text-sm text-muted">Last updated [DATE]</p>
        </header>

        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {PROMISES.map((x) => (
            <li key={x.title} className="flex flex-col gap-2 rounded-[24px] bg-forest p-7 text-forest-text">
              <h2 className="m-0 font-sans text-xl font-semibold tracking-[-0.02em] text-white">
                {x.title}
              </h2>
              <p className="m-0 text-[15px] leading-relaxed text-forest-ink">{x.body}</p>
            </li>
          ))}
        </ul>

        <div className="grid gap-16 md:grid-cols-12">
          <nav aria-label="On this page" className="md:col-span-3">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 md:sticky md:top-28">
              {[
                ["#privacy", "Privacy policy"],
                ["#terms", "Terms of service"],
                ["#delete", "Delete your data"],
                ["#contact", "Contact"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="flex min-h-11 items-center rounded-xl px-3 text-[15px] text-ink-2 no-underline fine:bg-page-hover fine:text-ink"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-20 md:col-span-9">
            <section id="privacy" className="flex scroll-mt-28 flex-col gap-8">
              <h2 className={h2}>Privacy policy</h2>
              {[
                ["What we collect", "[LEGAL TEXT — account details, connected-account data, content you create, usage data]"],
                ["How we use it", "[LEGAL TEXT — providing the service, generating captions, analytics, support]"],
                ["Who we share it with", "[LEGAL TEXT — social platforms you publish to, AI and hosting providers, payment processor]"],
              ].map(([t, body]) => (
                <div key={t} className="flex flex-col gap-2">
                  <h3 className={h3}>{t}</h3>
                  <p className={p}>{body}</p>
                </div>
              ))}
            </section>

            <section id="terms" className="flex scroll-mt-28 flex-col gap-4">
              <h2 className={h2}>Terms of service</h2>
              <p className={p}>
                [LEGAL TEXT &mdash; accounts, acceptable use, content ownership, plans
                and payment, termination, liability]
              </p>
            </section>

            <section id="delete" className="flex scroll-mt-28 flex-col gap-5">
              <h2 className={h2}>Delete your data</h2>
              <p className={p}>
                You can delete your Brandbuild account and everything in it at any time.
              </p>
              <ol className={`${p} list-decimal pl-6 [&>li]:pl-1 [&>li+li]:mt-2`}>
                <li>
                  Log in and open <strong>Settings &rarr; Data and privacy</strong>.
                </li>
                <li>
                  Select <strong>Delete account</strong> and confirm.
                </li>
                <li>
                  We delete your posts, drafts, brand voice, media and
                  connected-account tokens within [N] days.
                </li>
              </ol>
              <p className={p}>
                Can&apos;t log in? Email <strong>[SUPPORT EMAIL]</strong> from the
                address on your account and we&apos;ll do it for you.
              </p>
              <p className={p}>
                To remove only a social account, disconnect it in{" "}
                <strong>Settings &rarr; Connected accounts</strong>, or revoke
                Brandbuild&apos;s access in that platform&apos;s own app settings.
              </p>
              <Link href="/login" className="w-fit text-[15px] font-semibold">
                Log in to delete your account
              </Link>
            </section>

            <section id="contact" className="flex scroll-mt-28 flex-col gap-4">
              <h2 className={h2}>Contact</h2>
              <p className={p}>[COMPANY NAME, ADDRESS, SUPPORT EMAIL]</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
