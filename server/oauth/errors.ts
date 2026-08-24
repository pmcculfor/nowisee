export type OAuthErrorCode =
  | "not-signed-in"
  | "invalid-slot"
  | "invalid-return-path"
  | "missing"
  | "needs-reconnect"
  | "not-configured"
  | "provider-error";

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "OAuthError";
    this.code = code;
  }
}
