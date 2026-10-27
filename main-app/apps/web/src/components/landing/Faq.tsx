import { PlusMinusIcon } from "@/components/ui/icons";

const QUESTIONS = [
  {
    q: "Does Brandbuild post without asking me?",
    a: "No. It only publishes posts you’ve reviewed and scheduled yourself.",
  },
  {
    q: "Which platforms can I post to?",
    a: "[CONFIRM AT LAUNCH: Instagram, LinkedIn, TikTok, Facebook, YouTube.]",
  },
  {
    q: "Who counts as a student?",
    a: "Anyone with a school email address or a valid student ID. [ELIGIBILITY RULES]",
  },
  {
    q: "Can I edit what the AI writes?",
    a: "Every word. Or ask it to rewrite, shorten or change the tone with one tap.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto grid max-w-[1280px] gap-14 md:grid-cols-12">
        <h2 className="m-0 font-sans text-[clamp(2.5rem,5vw,4.5rem)] leading-[1] font-semibold tracking-[-0.045em] md:col-span-5">
          Questions
        </h2>
        <div className="flex flex-col md:col-span-7">
          {QUESTIONS.map((item) => (
            <details key={item.q} className="group border-b border-line first:border-t">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 text-xl font-semibold tracking-[-0.02em] marker:hidden [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-page-hover transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-45">
                  <PlusMinusIcon size={18} />
                </span>
              </summary>
              <p className="m-0 max-w-xl pb-6 text-[17px] leading-relaxed text-ink-2">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
