import { createConsoleMailer } from "./console.ts";
import { createResendMailer } from "./resend.ts";
import type { Mailer } from "./types.ts";

export type MailerFromEnvArgs = {
  readonly configuredOrigin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
};

export function mailerFromEnv(args: MailerFromEnvArgs = {}): Mailer {
  const env = args.env ?? process.env;
  const driver = (env.NOWISEE_MAIL_DRIVER ?? "console").trim().toLowerCase();
  if (driver === "console") {
    if (!isLocalOrigin(args.configuredOrigin)) {
      throw new Error("NOWISEE_MAIL_DRIVER=console is only allowed when NOWISEE_ORIGIN is localhost");
    }
    return createConsoleMailer();
  }
  if (driver === "resend") {
    const apiKey = env.NOWISEE_RESEND_API_KEY?.trim();
    const from = env.NOWISEE_MAIL_FROM?.trim();
    if (!apiKey || !from) {
      throw new Error("NOWISEE_RESEND_API_KEY and NOWISEE_MAIL_FROM are required when NOWISEE_MAIL_DRIVER=resend");
    }
    return createResendMailer({ apiKey, from, fetch: args.fetch });
  }
  throw new Error(`Unknown NOWISEE_MAIL_DRIVER: ${driver}`);
}

export function otpPepperFromEnv(
  args: { readonly env?: NodeJS.ProcessEnv; readonly allowDevDefault?: boolean } = {},
): Uint8Array {
  const env = args.env ?? process.env;
  const raw = env.NOWISEE_OTP_PEPPER?.trim();
  if (raw) {
    return parseOtpPepper(raw);
  }
  const driver = (env.NOWISEE_MAIL_DRIVER ?? "console").trim().toLowerCase();
  if (driver === "resend" || args.allowDevDefault === false) {
    throw new Error("NOWISEE_OTP_PEPPER is required when sending sign-in mail through Resend");
  }
  return DEV_OTP_PEPPER;
}

export function parseOtpPepper(raw: string): Uint8Array {
  const key = Buffer.from(raw, "base64");
  if (key.byteLength !== 32) {
    throw new Error("NOWISEE_OTP_PEPPER must be 32 bytes, base64-encoded");
  }
  return new Uint8Array(key);
}

/** Console/dev only. Never used when the Resend driver is selected. */
export const DEV_OTP_PEPPER = new Uint8Array(32).fill(1);

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
