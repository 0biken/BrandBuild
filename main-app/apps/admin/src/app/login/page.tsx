"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startGoogleLogin() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/v1/auth/google/start?format=json");
      const body = (await res.json().catch(() => null)) as
        | { data?: { authUrl?: string }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.data?.authUrl) {
        setError(
          body?.error?.message ??
            "Google Workspace sign-in is not configured on this server.",
        );
        setBusy(false);
        return;
      }
      window.location.assign(body.data.authUrl);
    } catch {
      setError("Could not reach the admin API.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-[420px] rounded-[22px] bg-surface p-7 shadow-[0_20px_50px_-24px_rgba(15,26,19,0.2)]">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-ink text-white">
            <svg
              width="18"
              height="20"
              viewBox="0 0 59 66"
              role="img"
              aria-label="Brandbuild"
            >
              <path
                d="M0 63.1688V26.0688C0 24.7053 1.1053 23.6 2.46875 23.6H17.5359C18.8994 23.6 20.0047 24.7053 20.0047 26.0688V40.6953C20.0047 43.4222 22.2153 45.6328 24.9422 45.6328H31.6406C33.0041 45.6328 34.1094 46.7381 34.1094 48.1016V63.1688C34.1094 64.5322 33.0041 65.6375 31.6406 65.6375H2.46875C1.1053 65.6375 0 64.5322 0 63.1688Z"
                fill="currentColor"
              />
              <path
                d="M24.8906 39.5688V2.46875C24.8906 1.1053 25.9959 0 27.3594 0H42.4266C43.79 0 44.8953 1.1053 44.8953 2.46875V17.0953C44.8953 19.8222 47.1059 22.0328 49.8328 22.0328H56.5313C57.8947 22.0328 59 23.1381 59 24.5016V39.5688C59 40.9322 57.8947 42.0375 56.5313 42.0375H27.3594C25.9959 42.0375 24.8906 40.9322 24.8906 39.5688Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            Brandbuild Admin
          </span>
        </div>

        <h1 className="mt-5 mb-2 font-display text-2xl font-bold tracking-tight">
          Staff sign in
        </h1>
        <p className="m-0 text-sm leading-relaxed text-ink-2">
          Access is restricted to allowlisted Brandbuild staff via Google
          Workspace SSO. Sessions expire after 8 hours or 30 minutes of
          inactivity.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger-ink"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={startGoogleLogin}
          className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-ink px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Redirecting to Google..." : "Continue with Google Workspace"}
        </button>

        <p className="mt-4 mb-0 text-xs text-muted">
          All staff logins, page views in support sessions, and administrative
          changes are recorded in the immutable audit log.
        </p>
      </div>
    </div>
  );
}
