/**
 * Client address for admin usage recording. Never taken from the JSON body.
 *
 * Production sits behind Caddy, so Node's socket is 127.0.0.1. Caddy appends
 * the TCP client onto X-Forwarded-For; the last hop is the address Caddy saw.
 * That is trustworthy only because port 3000 is not public.
 */

export function clientIpFromRequest(args: {
  readonly forwardedFor?: string;
  readonly remoteAddress?: string;
}): string {
  const forwarded = lastForwardedHop(args.forwardedFor);
  if (forwarded) {
    return canonicalizeIp(forwarded);
  }
  return canonicalizeIp(args.remoteAddress ?? "");
}

function lastForwardedHop(header: string | undefined): string {
  if (!header) {
    return "";
  }
  const parts = header.split(",");
  return parts[parts.length - 1]?.trim() ?? "";
}

function canonicalizeIp(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) {
    ip = ip.slice(1, -1);
  }
  const v4Port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4Port) {
    ip = v4Port[1]!;
  }
  if (ip.toLowerCase().startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return ip;
}
