import type { TokenPair } from "./types";

const ACCESS_KEY = "fa.access_token";
const REFRESH_KEY = "fa.refresh_token";

export function readTokens(): TokenPair | null {
  if (typeof window === "undefined") {
    return null;
  }
  const access_token = window.localStorage.getItem(ACCESS_KEY);
  const refresh_token = window.localStorage.getItem(REFRESH_KEY);
  if (!access_token || !refresh_token) {
    return null;
  }
  return { access_token, refresh_token, token_type: "bearer" };
}

export function writeTokens(tokens: TokenPair): void {
  window.localStorage.setItem(ACCESS_KEY, tokens.access_token);
  window.localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

const DEVICE_KEY = "fa.device_id";
const SESSION_ENDED_KEY = "fa.session_ended";

/**
 * A stable, opaque id for this browser profile. Deliberately not derived from
 * the IP or any fingerprint: it only has to distinguish one install from
 * another, and it is the server that decides which session wins.
 */
export function deviceId(): string {
  if (typeof window === "undefined") {
    return "server";
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) {
      return existing;
    }
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    // Private mode with storage blocked: a per-tab id still works.
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

/** Survives the redirect to /login so the reason can be shown there. */
export function rememberSessionEnded(reason: string): void {
  try {
    window.sessionStorage.setItem(SESSION_ENDED_KEY, reason);
  } catch {
    // Nothing to do: the user still lands on the login screen.
  }
}

export function takeSessionEndedReason(): string | null {
  try {
    const reason = window.sessionStorage.getItem(SESSION_ENDED_KEY);
    if (reason) {
      window.sessionStorage.removeItem(SESSION_ENDED_KEY);
    }
    return reason;
  } catch {
    return null;
  }
}
