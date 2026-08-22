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

export function expectedOriginFromRequest(args: {
  readonly host: string | undefined;
  readonly forwardedProto: string | undefined;
  readonly encrypted: boolean;
  readonly configuredOrigin?: string;
}): string | null {
  if (args.configuredOrigin) {
    return args.configuredOrigin.replace(/\/+$/, "");
  }
  if (!args.host) {
    return null;
  }
  const proto = (args.forwardedProto ?? (args.encrypted ? "https" : "http")).split(",")[0]!.trim();
  return `${proto}://${args.host}`;
}
