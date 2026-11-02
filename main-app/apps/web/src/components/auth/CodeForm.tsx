"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { MailIcon } from "@/components/ui/icons";
import { HOME_HREF, requestCode, verifyCode } from "@/lib/auth";
import { usePendingIdentifier } from "@/lib/pending";

const RESEND_SECONDS = 30;

type Status = "idle" | "checking" | "invalid" | "expired";

export function CodeForm() {
  const router = useRouter();
  const identifier = usePendingIdentifier();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [shakes, setShakes] = useState(0);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  async function submit(value: string) {
    setStatus("checking");
    setNote("");
    const res = await verifyCode(value);
    if (res.ok) {
      router.push(HOME_HREF);
      return;
    }
    setStatus(res.error === "expired" ? "expired" : "invalid");
    setShakes((n) => n + 1);
  }

  async function resend(channel: "email" | "sms") {
    if (channel === "sms") {
      setNote("SMS codes aren't available yet. We'll resend by email.");
    } else {
      setNote("We sent a new code.");
    }
    setCode("");
    setStatus("idle");
    setSeconds(RESEND_SECONDS);
    await requestCode(identifier);
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const invalid = status === "invalid" || status === "expired";

  return (
    <div className="flex flex-col gap-5">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary-ink">
        <MailIcon size={24} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-[32px] font-bold tracking-[-0.03em]">
          Check your {identifier.includes("@") || !identifier ? "email" : "phone"}
        </h1>
        <p className="m-0 text-[15px] text-ink-2">
          We sent a 6-digit code to{" "}
          <strong className="font-semibold text-ink">
            {identifier || "your account"}
          </strong>
          . <Link href="/signup" className="font-semibold">Change</Link>
        </p>
      </div>

      <div key={shakes} className={status === "invalid" ? "shake" : ""}>
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (status !== "checking") setStatus("idle");
          }}
          onComplete={submit}
          invalid={invalid}
          disabled={status === "checking"}
          autoFocus
          describedBy="code-status"
        />
      </div>

      <div id="code-status" className="flex flex-col gap-3">
        {status === "checking" && (
          <p role="status" className="m-0 text-sm text-muted">Checking your code...</p>
        )}
        {status === "invalid" && (
          <Alert tone="error">
            That code isn&apos;t right. Check the latest email, or send a new code.
          </Alert>
        )}
        {status === "expired" && (
          <Alert tone="error">
            This code has expired.{" "}
            <button
              type="button"
              onClick={() => resend("email")}
              className="cursor-pointer border-0 bg-transparent p-0 font-semibold underline"
            >
              Send a new one
            </button>
          </Alert>
        )}
        {note && <Alert tone="info">{note}</Alert>}
      </div>

      <p className="m-0 text-sm text-muted">
        Tip: paste the whole code into any box. It fills itself in and submits.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={seconds > 0}
          onClick={() => resend("email")}
        >
          {seconds > 0 ? (
            <>
              Resend in <span className="font-mono tabular-nums">{mm}</span>
            </>
          ) : (
            "Resend code"
          )}
        </Button>
        <button
          type="button"
          onClick={() => resend("sms")}
          className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-[15px] font-semibold text-primary-hover underline-offset-2 hover:underline"
        >
          Send by SMS instead
        </button>
      </div>

      <p className="m-0 text-sm text-muted">
        Not in your inbox? Check spam or promotions. Codes expire after [N] minutes.
      </p>
    </div>
  );
}
