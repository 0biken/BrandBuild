import type { PlatformConfig } from "@/lib/api/types";

/**
 * Square platform mark ("IG", "in", ...). Decorative by default; pass
 * `labelled` to expose the platform name to assistive tech.
 */
export function PlatformBadge({
  platform,
  size = 24,
  labelled = false,
}: {
  platform: Pick<PlatformConfig, "k" | "bg" | "name">;
  size?: number;
  labelled?: boolean;
}) {
  return (
    <span
      role={labelled ? "img" : undefined}
      aria-label={labelled ? platform.name : undefined}
      aria-hidden={labelled ? undefined : true}
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: platform.bg,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {platform.k}
    </span>
  );
}
