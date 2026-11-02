import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { photo } from "@/lib/images";

const card = "group relative overflow-hidden rounded-[28px] p-8 md:p-9";
const h3 =
  "m-0 font-sans text-[clamp(1.5rem,2.4vw,2.25rem)] leading-[1.05] font-semibold tracking-[-0.035em]";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FILLED = [true, false, true, false, true, false, false];

/**
 * Bento: 4 columns x 3 rows = 12 cells, grid-flow-dense.
 * Voice 2x2 (4) + Previews 2x1 (2) + Calendar 2x1 (2) + Insights 2x1 (2)
 * + Health 2x1 (2) = 12. No dead cells.
 */
export function Features() {
  return (
    <section id="features" className="scroll-mt-24 bg-surface-2 px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto max-w-[1280px]">
        <h2 className="m-0 max-w-5xl font-sans text-[clamp(2.5rem,5vw,4.5rem)] leading-[1] font-semibold tracking-[-0.04em]">
          Everything a small brand needs to post every week.
        </h2>

        <div className="mt-16 grid grid-flow-dense auto-rows-[minmax(250px,auto)] grid-cols-4 gap-4 md:mt-24 max-md:grid-cols-1">
          {/* Brand voice: 2 cols x 2 rows */}
          <article className={`${card} bg-forest text-forest-text md:col-span-2 md:row-span-2`}>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -bottom-24 size-[380px] rounded-full bg-primary/30 blur-[90px]"
            />
            <div className="relative flex h-full flex-col justify-between gap-10">
              <div className="flex flex-col gap-4">
                <span className="w-fit rounded-full bg-lime px-3 py-1 text-sm font-semibold text-forest">
                  Brand voice
                </span>
                <h3 className={`${h3} max-w-md text-white`}>
                  Captions that sound like your team wrote them.
                </h3>
                <p className="m-0 max-w-md text-base leading-relaxed text-forest-ink">
                  Set your tone once. Every caption follows it, avoids the words
                  you hate and uses the ones your customers know you for.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-2xl bg-white p-5 text-ink">
                  <p className="m-0 mb-2 flex items-center gap-2 text-sm font-semibold text-primary-ink">
                    <CheckIcon size={16} /> Warm + Playful
                  </p>
                  <p className="m-0 text-[17px] leading-snug">
                    &ldquo;Plot twist: your lips called and they want the new shade.
                    Friday, 7 PM.&rdquo;
                  </p>
                </div>
                <div className="rounded-2xl bg-forest-2 p-5">
                  <p className="m-0 mb-2 flex items-center gap-2 text-sm font-semibold text-forest-ink">
                    <AlertIcon size={16} /> Off voice, not used
                  </p>
                  <p className="m-0 text-[17px] leading-snug text-forest-ink line-through decoration-forest-line">
                    &ldquo;Our flawless, cheap lip gloss is now available.&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </article>

          {/* Previews: 2 x 1 */}
          <article className={`${card} border border-line bg-surface md:col-span-2`}>
            <div className="relative z-10 flex max-w-[56%] flex-col gap-3 max-md:max-w-full">
              <h3 className={h3}>See it before your followers do.</h3>
              <p className="m-0 text-base leading-relaxed text-ink-2">
                Each platform gets its own preview, crop and character count.
              </p>
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-y-0 right-0 w-[42%] overflow-hidden max-md:hidden"
            >
              <div
                className="size-full bg-cover bg-center contrast-110 grayscale-[40%] transition-transform duration-700 ease-out group-hover:scale-105"
                style={{ backgroundImage: `url(${photo("preview-frame", 800, 900)})` }}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/10 to-transparent" />
            </div>
          </article>

          {/* Calendar: 2 x 1 */}
          <article className={`${card} bg-lime text-forest md:col-span-2`}>
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <h3 className={h3}>Drag a post to a new day.</h3>
                <p className="m-0 max-w-md text-base leading-relaxed text-forest/80">
                  Your whole month on one screen. Brandbuild flags the gaps.
                </p>
              </div>
              <ol aria-hidden="true" className="m-0 grid list-none grid-cols-7 gap-2 p-0">
                {DAYS.map((d, i) => (
                  <li
                    key={d}
                    className={`flex h-14 flex-col items-center justify-between rounded-xl py-2 text-xs font-semibold ${
                      FILLED[i]
                        ? "bg-forest text-white"
                        : "border border-dashed border-forest/40 text-forest/70"
                    }`}
                  >
                    {d}
                    <span className={`size-1.5 rounded-full ${FILLED[i] ? "bg-lime" : "bg-transparent"}`} />
                  </li>
                ))}
              </ol>
            </div>
          </article>

          {/* Insights: 2 x 1 */}
          <article className={`${card} border border-line bg-surface md:col-span-2`}>
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <h3 className={h3}>Learn what works, then do more of it.</h3>
                <p className="m-0 max-w-md text-base leading-relaxed text-ink-2">
                  Weekly results turned into your next post idea.
                </p>
              </div>
              <div aria-hidden="true" className="flex h-16 items-end gap-2">
                {[34, 52, 40, 78, 96, 58, 44].map((h, i) => (
                  <span
                    key={i}
                    className={`flex-1 origin-bottom rounded-t-lg transition-transform duration-500 ease-out group-hover:scale-y-110 ${
                      i === 4 ? "bg-primary" : "bg-primary-soft"
                    }`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </article>

          {/* Account health: 2 x 1 */}
          <article className={`${card} border border-line bg-page-hover md:col-span-2`}>
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <h3 className={h3}>No silent failures.</h3>
                <p className="m-0 max-w-md text-base leading-relaxed text-ink-2">
                  If an account disconnects, you hear about it before a post is missed.
                </p>
              </div>
              <ul aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
                <li className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
                  <span className="font-semibold">Instagram</span>
                  <span className="flex items-center gap-1.5 text-primary-ink">
                    <CheckIcon size={16} /> Connected
                  </span>
                </li>
                <li className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
                  <span className="font-semibold">LinkedIn</span>
                  <span className="flex items-center gap-1.5 text-amber-ink">
                    <AlertIcon size={16} /> Reconnect needed
                  </span>
                </li>
              </ul>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
