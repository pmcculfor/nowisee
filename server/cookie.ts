export const SESSION_COOKIE_NAME = "__Host-nowisee_session";

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const cut = part.indexOf("=");
    if (cut < 0) {
      continue;
    }
    const name = part.slice(0, cut).trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }
    return part.slice(cut + 1).trim();
  }
  return null;
}

/**
 * Serialize the session cookie. `token === null` clears it.
 * `__Host-` requires Secure, Path=/, and no Domain.
 * SameSite=Lax is set explicitly (layer 1 of CSRF).
 */
export function serializeSessionCookie(token: string | null, expiresAt?: number): string {
  const maxAge =
    token && expiresAt !== undefined ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0;
  const value = token ?? "";
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
