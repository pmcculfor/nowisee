import { createResendMailer } from "./resend.ts";
import type { Mailer } from "./types.ts";

const OTP_PEPPER_LENGTH = 32;

export type MailerFromEnvArgs = {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
};

/** Every host that sends mail sends it through Resend. Tests use the silent mailer. */
export function mailerFromEnv(args: MailerFromEnvArgs = {}): Mailer {
  const env = args.env ?? process.env;
  const apiKey = env.NOWISEE_RESEND_API_KEY?.trim();
  const from = env.NOWISEE_MAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("NOWISEE_RESEND_API_KEY and NOWISEE_MAIL_FROM are required");
  }
  return createResendMailer({ apiKey, from, fetch: args.fetch });
}

export function otpPepperFromEnv(args: { readonly env?: NodeJS.ProcessEnv } = {}): Uint8Array {
  const raw = (args.env ?? process.env).NOWISEE_OTP_PEPPER?.trim();
  if (!raw) {
    throw new Error("NOWISEE_OTP_PEPPER is required");
  }
  return parseOtpPepper(raw);
}

export function parseOtpPepper(raw: string): Uint8Array {
  const key = Buffer.from(raw, "base64");
  if (key.byteLength !== OTP_PEPPER_LENGTH) {
    throw new Error("NOWISEE_OTP_PEPPER must be 32 bytes, base64-encoded");
  }
  return new Uint8Array(key);
}
