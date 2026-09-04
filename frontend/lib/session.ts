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
