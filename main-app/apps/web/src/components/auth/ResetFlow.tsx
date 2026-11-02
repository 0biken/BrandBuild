"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { Field } from "@/components/ui/Field";
import { CheckIcon } from "@/components/ui/icons";
import { PasswordChecklist } from "@/components/ui/PasswordChecklist";
import { PasswordField } from "@/components/ui/PasswordField";
import { HOME_HREF, requestCode, resetPassword, verifyCode } from "@/lib/api/auth";
import { passwordValid } from "@/lib/password";

const STEPS = ["Request a code", "Enter the code", "New password"] as const;

const H1 = "m-0 font-display text-[32px] font-bold tracking-[-0.03em] outline-none";

export function ResetFlow() {
  const [step, setStep] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLDivElement>(null);

  // Move focus to the new step's heading so keyboard and screen reader users
  // land on the change.
  useEffect(() => {
    heading.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [step]);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (busy || identifier.trim() === "") return;
    setBusy(true);
    setError("");
    await requestCode(identifier.trim());
    setBusy(false);
    setStep(1);
  }

  async function checkCode(value = code) {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError("");
    const res = await verifyCode(value);
    setBusy(false);
    if (res.ok) {
      setStep(2);
    } else {
      setError(
        res.error === "expired"
          ? "This code has expired. Go back and request a new one."
          : "That code isn't right. Check the latest email and try again.",
      );
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !passwordValid(password)) return;
    setBusy(true);
    setError("");
    const res = await resetPassword(password);
    setBusy(false);
    if (res.ok) setStep(3);
    else setError("We couldn't save your password. Try again.");
  }

  function restart() {
    setStep(0);
    setCode("");
    setPassword("");
    setError("");
  }

  return (
    <div className="flex flex-col gap-6">
      {step < 3 && (
        <ol aria-label="Steps" className="m-0 flex list-none gap-1.5 p-0">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? "step" : undefined}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-line"}`}
            >
              <span className="sr-only">
                {label}
                {i < step ? ", done" : i === step ? ", current" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}

      {step === 0 && (
        <form key="s0" onSubmit={sendCode} noValidate className="step-in flex flex-col gap-5">
          <div ref={heading} className="flex flex-col gap-1.5">
            <h1 tabIndex={-1} className={H1}>Forgot your password?</h1>
            <p className="m-0 text-[15px] text-ink-2">
              Enter the email or phone number on your account. We&apos;ll send a code.
            </p>
          </div>
          <Field
            id="reset-identifier"
            label="Email or phone number"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
          <Button
            type="submit"
            size="lg"
            block
            aria-disabled={busy || identifier.trim() === ""}
          >
            {busy ? "Sending..." : "Send code"}
          </Button>
          <Link href="/login" className="text-center text-[15px] font-semibold">
            Back to log in
          </Link>
        </form>
      )}

      {step === 1 && (
        <form
          key="s1"
          onSubmit={(e) => {
            e.preventDefault();
            checkCode();
          }}
          className="step-in flex flex-col gap-5"
        >
          <div ref={heading} className="flex flex-col gap-1.5">
            <h1 tabIndex={-1} className={H1}>Enter the code</h1>
            <p className="m-0 text-[15px] text-ink-2">
              Sent to <strong className="font-semibold text-ink">{identifier}</strong>.
            </p>
          </div>
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setError("");
            }}
            onComplete={checkCode}
            invalid={error !== ""}
            disabled={busy}
            describedBy="reset-code-status"
          />
          <div id="reset-code-status">
            {error && <Alert tone="error">{error}</Alert>}
          </div>
          <Button
            type="submit"
            size="lg"
            block
            aria-disabled={busy || code.length !== 6}
          >
            {busy ? "Checking..." : "Continue"}
          </Button>
          <Button variant="ghost" size="lg" block onClick={restart}>
            Use a different email
          </Button>
        </form>
      )}

      {step === 2 && (
        <form key="s2" onSubmit={save} noValidate className="step-in flex flex-col gap-5">
          <div ref={heading} className="flex flex-col gap-1.5">
            <h1 tabIndex={-1} className={H1}>Choose a new password</h1>
            <p className="m-0 text-[15px] text-ink-2">
              You&apos;ll be logged out on other devices.
            </p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            aria-describedby="new-password-rules"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordChecklist id="new-password-rules" value={password} />
          <Button
            type="submit"
            size="lg"
            block
            aria-disabled={busy || !passwordValid(password)}
          >
            {busy ? "Saving..." : "Save new password"}
          </Button>
        </form>
      )}

      {step === 3 && (
        <div key="s3" className="step-in flex flex-col items-start gap-5">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary text-white">
            <CheckIcon size={26} />
          </span>
          <div ref={heading} className="flex flex-col gap-1.5">
            <h1 tabIndex={-1} className={H1}>Password changed</h1>
            <p className="m-0 text-[15px] text-ink-2">
              You&apos;re logged in. We&apos;ve signed you out everywhere else.
            </p>
          </div>
          <ButtonLink href={HOME_HREF} size="lg" block>
            Go to Home
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
