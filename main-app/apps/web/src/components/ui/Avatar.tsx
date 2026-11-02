const TONES = ["bg-lime text-forest", "bg-primary-soft text-primary-ink", "bg-info-soft text-info-ink", "bg-amber-soft text-amber-ink"];

/** Initial-letter avatar. The tone is stable per name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const tone = TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold ${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
