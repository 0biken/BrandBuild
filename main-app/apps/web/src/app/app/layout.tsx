import { ToastProvider } from "@/components/ui/Toast";

/** Everything under /app: the main screens and onboarding share toasts. */
export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
