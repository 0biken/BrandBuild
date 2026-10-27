import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

/** Form on the left, dark forest panel on the right (hidden below 860px). */
export function SplitShell({
  children,
  aside,
}: {
  children: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full bg-page">
      <main className="flex min-w-0 flex-1 basis-[520px] flex-col px-14 pt-8 pb-12 max-md:px-4 max-md:pt-6 max-md:pb-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>
      </main>
      <aside
        aria-hidden="true"
        className="flex flex-1 basis-[520px] flex-col justify-center bg-forest p-14 text-forest-text max-md:hidden"
      >
        {aside}
      </aside>
    </div>
  );
}

/** Single centred card on the page background. */
export function CenterShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col gap-10 bg-page px-14 pt-8 pb-14 max-md:px-4 max-md:pt-6 max-md:pb-10">
      <Logo />
      <main className="flex flex-1 items-start justify-center">
        <section className="w-full max-w-[480px] rounded-[28px] border border-line bg-surface p-9 shadow-[0_24px_48px_-28px_rgba(15,26,19,0.22)] max-md:rounded-3xl max-md:p-6">
          {children}
        </section>
      </main>
    </div>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
