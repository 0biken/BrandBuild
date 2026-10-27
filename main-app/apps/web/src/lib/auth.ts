/**
 * Auth boundary for the web app.
 *
 * Every function here is a MOCK that resolves after a short delay. The Rust
 * API (see main-app/TASKS.md, Phase 0) replaces these bodies; callers and
 * result types stay the same.
 *
 * Mock behaviour, so every designed state is reachable in development:
 *  - logIn:        succeeds only for MOCK_ACCOUNT; anything else is "invalid".
 *  - verifyCode:   MOCK_CODE succeeds, MOCK_EXPIRED_CODE is "expired",
 *                  any other 6 digits is "invalid".
 *  - resetPassword / requestCode / signUp: always succeed.
 */

export type AuthError = "invalid" | "expired" | "network";
export type AuthResult = { ok: true } | { ok: false; error: AuthError };

export type Provider = "google" | "apple";

export const MOCK_ACCOUNT = {
  identifier: "mary@novastudio.co",
  password: "Glossdrop26",
} as const;
export const MOCK_CODE = "123456";
export const MOCK_EXPIRED_CODE = "000000";

const wait = (ms = 600) => new Promise<void>((r) => setTimeout(r, ms));

export async function signUp(input: {
  name: string;
  identifier: string;
  password: string;
}): Promise<AuthResult> {
  void input;
  await wait();
  return { ok: true };
}

export async function logIn(input: {
  identifier: string;
  password: string;
}): Promise<AuthResult> {
  await wait();
  const ok =
    input.identifier.trim().toLowerCase() === MOCK_ACCOUNT.identifier &&
    input.password === MOCK_ACCOUNT.password;
  return ok ? { ok: true } : { ok: false, error: "invalid" };
}

export async function signInWithProvider(provider: Provider): Promise<AuthResult> {
  void provider;
  await wait(300);
  return { ok: false, error: "network" };
}

export async function requestCode(identifier: string): Promise<AuthResult> {
  void identifier;
  await wait();
  return { ok: true };
}

export async function verifyCode(code: string): Promise<AuthResult> {
  await wait();
  if (code === MOCK_CODE) return { ok: true };
  if (code === MOCK_EXPIRED_CODE) return { ok: false, error: "expired" };
  return { ok: false, error: "invalid" };
}

export async function resetPassword(password: string): Promise<AuthResult> {
  void password;
  await wait();
  return { ok: true };
}

/** Where a signed-in user lands. The app shell is built in a later slice. */
export const HOME_HREF = "/home";
