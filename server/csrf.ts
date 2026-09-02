export type CsrfFailure = "content-type" | "origin";

/**
 * CSRF layers 2 and 3 at the /api boundary.
 * Layer 1 is SameSite=Lax on the session cookie (set explicitly, not by browser default).
 * Each check is independent: a request can fail one while passing the other.
 */
export function checkCsrf(args: {
  readonly contentType: string | undefined;
  readonly origin: string | undefined;
  readonly expectedOrigin: string;
}): { ok: true } | { ok: false; reason: CsrfFailure } {
  const mediaType = (args.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, reason: "content-type" };
  }
  if (!args.origin || args.origin !== args.expectedOrigin) {
    return { ok: false, reason: "origin" };
  }
  return { ok: true };
}

/**
 * Exact Origin for CSRF layer 3. Only the configured public origin
 * (`NOWISEE_ORIGIN`). Unset means every Origin check fails.
 */
export function expectedOriginFromRequest(configuredOrigin?: string): string {
  return (configuredOrigin ?? "").replace(/\/+$/, "");
}
