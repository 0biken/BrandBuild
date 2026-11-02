import type { ReactNode } from "react";

/**
 * CSS-only tooltip shown on hover (fine pointers) and keyboard focus.
 * `children` receives the id to put in the trigger's aria-describedby, so
 * screen-reader users get the text too.
 *
 *   <Tooltip id="retry-tip" text="Retry is blocked while we check">
 *     {(d) => <Button aria-describedby={d}>Retry</Button>}
 *   </Tooltip>
 */
export function Tooltip({
  id,
  text,
  children,
}: {
  id: string;
  text: string;
  children: (describedBy: string) => ReactNode;
}) {
  return (
    <span className="group relative inline-flex">
      {children(id)}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 translate-y-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white opacity-0 transition-[opacity,transform] duration-150 group-focus-within:translate-y-0 group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-y-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
