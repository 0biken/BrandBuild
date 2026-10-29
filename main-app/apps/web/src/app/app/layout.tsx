import { Rail } from "@/components/app-shell/Rail";
import { TabBar } from "@/components/app-shell/TabBar";
import { ToastProvider } from "@/components/ui/Toast";

/** Customer-app shell: rail on desktop, tab bar on phones. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <a
        href="#app-main"
        className="sr-only-focusable fixed top-3 left-3 z-[200] rounded-xl bg-ink px-4 py-3 font-semibold text-white no-underline"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen w-full bg-page">
        <Rail />
        <main
          id="app-main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-10 pt-7 pb-12 outline-none max-md:px-4 max-md:pt-5 max-md:pb-28"
        >
          {children}
        </main>
      </div>
      <TabBar />
    </ToastProvider>
  );
}
