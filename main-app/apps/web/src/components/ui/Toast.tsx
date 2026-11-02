"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";

type Toast = {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
  /** e.g. Undo. Runs, then dismisses the toast. */
  action?: { label: string; onAction: () => void };
};

type ToastInput = Omit<Toast, "id">;

const Ctx = createContext<((t: ToastInput) => void) | null>(null);

const DURATION_MS = 6000;

/**
 * Toast region. One polite live region announces every toast; errors also
 * get role="alert". Toasts with an action stay up long enough to use it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.action ? DURATION_MS * 1.5 : DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4 max-md:bottom-24"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink py-2.5 pr-2 pl-4 text-[15px] text-white shadow-[0_20px_40px_-20px_rgba(15,26,19,0.6)]"
          >
            <span className={t.tone === "error" ? "text-[#FF9C93]" : "text-lime"}>
              {t.tone === "error" ? <AlertIcon size={18} /> : <CheckIcon size={18} />}
            </span>
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onAction();
                  dismiss(t.id);
                }}
                className="press min-h-11 cursor-pointer rounded-xl border-0 bg-transparent px-3 font-semibold text-lime fine:bg-white/10"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="press inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-white/70 fine:bg-white/10"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}
