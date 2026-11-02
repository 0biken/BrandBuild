const PLATFORMS = ["Instagram", "LinkedIn", "TikTok", "Facebook", "YouTube"];

/**
 * Infinite marquee of the launch platforms. The track is rendered twice and
 * translated -50% so the loop is seamless. The second copy is hidden from
 * assistive tech; reduced-motion users get a static, wrapped row.
 */
export function Marquee() {
  const row = (hidden: boolean) => (
    <ul
      aria-hidden={hidden || undefined}
      className="m-0 flex shrink-0 list-none items-center gap-14 p-0 pr-14"
    >
      {PLATFORMS.map((p) => (
        <li key={p} className="flex items-center gap-14 whitespace-nowrap">
          <span className="font-sans text-[clamp(2.5rem,6vw,5rem)] leading-none font-semibold tracking-[-0.04em] text-ink">
            {p}
          </span>
          <span className="size-3 rounded-full bg-primary" />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-label="Publishes to" className="border-y border-line bg-surface-2 py-10 md:py-14">
      <div className="flex w-max motion-safe:animate-[marquee_38s_linear_infinite] motion-reduce:w-full motion-reduce:flex-wrap motion-reduce:justify-center">
        {row(false)}
        <div className="motion-reduce:hidden">{row(true)}</div>
      </div>
    </section>
  );
}
