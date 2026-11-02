"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PasswordChecklist } from "@/components/ui/PasswordChecklist";
import { PasswordField } from "@/components/ui/PasswordField";
import { signUp } from "@/lib/auth";
import { setPendingIdentifier } from "@/lib/pending";
import { passwordValid } from "@/lib/password";
import { Divider } from "./AuthShell";
import { SocialButtons } from "./SocialButtons";

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pwOk = passwordValid(password);
  const filled = name.trim() !== "" && identifier.trim() !== "";
  const ready = filled && pwOk && agree;

  const hint = !filled
    ? "Add your name and email or phone number to continue."
    : !pwOk
      ? "Finish the password checklist to continue."
      : !agree
        ? "Tick the box to agree to the terms."
        : "We'll send a code to confirm your email.";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const res = await signUp({ name: name.trim(), identifier: identifier.trim(), password });
    if (!res.ok) {
      setBusy(false);
      setError("We couldn't create your account. Check your connection and try again.");
      return;
    }
    setPendingIdentifier(identifier.trim());
    router.push("/code");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-[32px] font-bold tracking-[-0.03em]">
          Create your account
        </h1>
        <p className="m-0 text-[15px] text-ink-2">
          Already have one? <Link href="/login" className="font-semibold">Log in</Link>
        </p>
      </div>

      <SocialButtons />
      <Divider>or with email</Divider>

      {error && <Alert tone="error">{error}</Alert>}

      <Field
        id="name"
        label="Name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        id="identifier"
        label="Email or phone number"
        type="text"
        autoComplete="email"
        inputMode="email"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
      />
      <div className="flex flex-col gap-3">
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          aria-describedby="password-rules"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordChecklist id="password-rules" value={password} />
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px] leading-snug text-ink-2">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>
          I agree to the <Link href="/legal" className="font-semibold">Terms</Link> and{" "}
          <Link href="/legal" className="font-semibold">Privacy policy</Link>.
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" block aria-disabled={!ready || busy}>
          {busy ? "Creating account..." : "Create account"}
        </Button>
        <p aria-live="polite" className="m-0 text-center text-sm text-muted">
          {hint}
        </p>
      </div>
    </form>
  );
}
