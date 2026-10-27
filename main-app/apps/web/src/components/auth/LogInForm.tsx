"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { HOME_HREF, logIn } from "@/lib/auth";
import { Divider } from "./AuthShell";
import { SocialButtons } from "./SocialButtons";

export function LogInForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || identifier.trim() === "" || password === "") return;
    setBusy(true);
    setFailed(false);
    const res = await logIn({ identifier, password });
    if (!res.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    router.push(HOME_HREF);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-[32px] font-bold tracking-[-0.03em]">
          Welcome back
        </h1>
        <p className="m-0 text-[15px] text-ink-2">
          New here? <Link href="/signup" className="font-semibold">Create an account</Link>
        </p>
      </div>

      {failed && (
        <Alert tone="error">
          That email and password don&apos;t match. Check for typos, or{" "}
          <Link href="/reset">reset your password</Link>.
        </Alert>
      )}

      <Field
        id="identifier"
        label="Email or phone number"
        type="text"
        autoComplete="username"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
      />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="current-password"
        value={password}
        aria-invalid={failed ? true : undefined}
        onChange={(e) => setPassword(e.target.value)}
        labelAside={
          <Link href="/reset" className="text-sm font-semibold">
            Forgot password?
          </Link>
        }
      />

      <Button
        type="submit"
        size="lg"
        block
        aria-disabled={busy || identifier.trim() === "" || password === ""}
      >
        {busy ? "Logging in..." : "Log in"}
      </Button>

      <Divider>or log in with</Divider>
      <SocialButtons />
    </form>
  );
}
