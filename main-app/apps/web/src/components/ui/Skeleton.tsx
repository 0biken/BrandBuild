/** Loading placeholder. Pulse is disabled under reduced motion. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-xl bg-line motion-safe:animate-pulse ${className}`}
    />
  );
}
