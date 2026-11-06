"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { Field } from "@/components/ui/Field";
import { CheckIcon, MailIcon, ShieldIcon } from "@/components/ui/icons";
import { DEMO_CODES } from "@/lib/api/auth";
import { sendStudentCode, skipStudentCheck, studentIdProblem, submitStudentId, verifyStudentCode } from "@/lib/api/verify";
import { OnboardingShell, StepActions } from "./OnboardingShell";
import { useOnboardingNav } from "./useOnboardingNav";

const RESEND_SECONDS = 30;

type Method = "email" | "id";

const BENEFITS = ["AI captions in your brand voice", "Scheduling to [N] connected accounts", "Weekly performance insights"];

export function VerifyStep() {
  const advance = useOnboardingNav();
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  async function sendCode() {
    setBusy(true);
    setError("");
    const res = await sendStudentCode(email);
    setBusy(false);
    if (!res.ok) {
      setError("Check the email address. It should look like name@school.edu.ng.");
      return;
    }
    setSentTo(email.trim());
    setCode("");
    setSeconds(RESEND_SECONDS);
  }

  async function checkCode(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    const res = await verifyStudentCode(value);
    if (!res.ok) {
      setBusy(false);
      setError(
        res.error === "expired"
          ? "That code has expired. Send a new one."
          : "That code isn't right. Check the latest email from us.",
      );
      return;
    }
    await advance("verify", "done");
  }

  async function submitId() {
    if (!file) {
      setError("Choose a photo or PDF of your student ID.");
      return;
    }
    const problem = studentIdProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    const res = await submitStudentId(file);
    if (!res.ok) {
      setBusy(false);
      setError("We couldn't upload that file. Try again.");
      return;
    }
    // Review is async; setup continues meanwhile.
    await advance("verify", "done");
  }

  async function notStudent() {
    setBusy(true);
    await skipStudentCheck();
    await advance("verify", "skipped");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (method === "id") submitId();
    else if (!sentTo) sendCode();
    else checkCode();
  }

  const cta = method === "email" ? (sentTo ? "Verify and continue" : "Continue") : "Submit for review";

  return (
    <OnboardingShell
      step="verify"
      title="Confirm you're a student"
      intro="This unlocks Student Access. It takes about a minute with a school email."
      panel={
        <div className="flex flex-col gap-3 rounded-[20px] bg-forest-2 p-5">
          <span className="text-xs font-semibold tracking-[0.06em] text-lime uppercase">Student Access</span>
          <span className="font-display text-2xl font-bold text-white">Free until [END DATE]</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-center gap-2.5">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-lime text-forest">
                  <CheckIcon size={12} />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">How do you want to confirm?</legend>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {(
              [
                ["email", "School email", "Instant · we send a 6-digit code", MailIcon],
                ["id", "Student ID", "Reviewed within [X HOURS]", ShieldIcon],
              ] as const
            ).map(([id, label, sub, Icon]) => (
              <label
                key={id}
                className={`press flex cursor-pointer items-start gap-3 rounded-2xl p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                  method === id
                    ? "bg-[#F2FAF5] shadow-[inset_0_0_0_2px_var(--color-primary)]"
                    : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  checked={method === id}
                  onChange={() => {
                    setMethod(id);
                    setError("");
                  }}
                  className="sr-only"
                />
                <Icon size={22} className="mt-0.5 shrink-0 text-primary-ink" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{label}</span>
                  <span className="text-[13px] text-muted">{sub}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {method === "email" && !sentTo && (
          <Field
            id="school-email"
            label="School email address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="Most Nigerian university addresses end in .edu.ng. Others work too."
          />
        )}

        {method === "email" && sentTo && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[15px] text-ink-2">
              Enter the code we sent to <strong className="text-ink">{sentTo}</strong>.
            </p>
            {DEMO_CODES && (
              <Alert tone="info">Demo mode: no email is sent yet. Enter any 6 digits to continue.</Alert>
            )}
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v);
                setError("");
              }}
              onComplete={checkCode}
              invalid={!!error}
              disabled={busy}
              autoFocus
              describedBy="student-code-help"
            />
            <p id="student-code-help" className="m-0 text-sm text-muted">Paste the whole code into any box.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={seconds > 0 || busy} onClick={sendCode}>
                {seconds > 0 ? (
                  <>
                    Resend in <span className="font-mono tabular-nums">0:{String(seconds).padStart(2, "0")}</span>
                  </>
                ) : (
                  "Resend code"
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSentTo(null);
                  setError("");
                }}
              >
                Use a different email
              </Button>
            </div>
          </div>
        )}

        {method === "id" && (
          <div className="flex flex-col gap-2">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setFile(e.dataTransfer.files[0] ?? null);
                setError("");
              }}
              className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#C7CCC1] bg-surface-2 p-6 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
            >
              <span className="text-[15px] font-semibold">
                {file ? file.name : "Drop a photo of your student ID"}
              </span>
              <span className="text-[13px] text-muted">Front side, name and expiry visible · JPG, PNG or PDF</span>
              <span className="mt-1 inline-flex h-10 items-center rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold">
                {file ? "Choose another file" : "Choose file"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError("");
                }}
              />
            </label>
            <p className="m-0 text-sm text-muted">
              A person reviews it within [X HOURS]. You can keep setting up while you wait.
            </p>
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <StepActions>
          <Button
            type="submit"
            size="lg"
            disabled={busy}
            aria-disabled={method === "email" && !!sentTo && code.length !== 6}
          >
            {busy ? "Working..." : cta}
          </Button>
          <Button variant="ghost" onClick={notStudent} disabled={busy}>
            I&apos;m not a student
          </Button>
        </StepActions>
      </form>
    </OnboardingShell>
  );
}
