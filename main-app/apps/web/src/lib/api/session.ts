/**
 * Session cookie shared by the client and src/proxy.ts.
 *
 * In mock mode the client writes a placeholder cookie so the proxy's
 * signed-in check works end to end. In http mode the Rust API sets an
 * HttpOnly cookie with this name and the client never touches it.
 */
export const SESSION_COOKIE = "bb_session";

/** Signed-in users land here. All customer-app routes live under it. */
export const APP_HOME = "/app";

export function setMockSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=mock; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
}

export function clearMockSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}
