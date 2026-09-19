/**
 * Request headers as Node hands them over, plus the one reader every HTTP
 * surface in the host needs. Not an app concern: apps never see a request.
 */
export type HeadersLike = {
  readonly [name: string]: string | string[] | undefined;
};

/** First value for a header, case-insensitively. Repeated headers arrive as arrays. */
export function header(headers: HeadersLike, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
