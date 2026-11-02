"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { AppleIcon, GoogleIcon } from "@/components/ui/icons";
import { signInWithProvider, type Provider } from "@/lib/api/auth";

export function SocialButtons() {
  const [pending, setPending] = useState<Provider | null>(null);
  const [message, setMessage] = useState("");

  async function go(provider: Provider) {
    setPending(provider);
    setMessage("");
    const res = await signInWithProvider(provider);
    setPending(null);
    if (!res.ok) {
      setMessage(
        `${provider === "google" ? "Google" : "Apple"} sign-in isn't available yet. Use your email for now.`,
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          onClick={() => go("google")}
          disabled={pending !== null}
        >
          <GoogleIcon />
          Google
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => go("apple")}
          disabled={pending !== null}
        >
          <AppleIcon />
          Apple
        </Button>
      </div>
      {message && <Alert tone="info">{message}</Alert>}
    </div>
  );
}
