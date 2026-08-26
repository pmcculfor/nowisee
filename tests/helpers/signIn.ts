import { SESSION_COOKIE_NAME } from "../../server/cookie.ts";
import type { NowiseeHost } from "../../server/host.ts";
import { extractSignInCodeFromEmailText } from "../../server/identity/code.ts";
import type { Mailer, MailMessage } from "../../server/mail/types.ts";

export const TEST_OTP_PEPPER = new Uint8Array(32).fill(3);

export type CapturingMailer = Mailer & {
  readonly messages: MailMessage[];
  lastCode(): string;
};

export function capturingMailer(): CapturingMailer {
  const messages: MailMessage[] = [];
  return {
    messages,
    lastCode() {
      const text = messages.at(-1)?.text;
      if (!text) {
        throw new Error("no sign-in mail captured");
      }
      const code = extractSignInCodeFromEmailText(text);
      if (!code) {
        throw new Error("captured mail had no sign-in code");
      }
      return code;
    },
    async send(message) {
      messages.push(message);
    },
  };
}

export async function signInForTest(
  host: NowiseeHost,
  mailer: CapturingMailer,
  email: string,
): Promise<{ cookie: string; userId: string; sessionId: string }> {
  const anon = await host.identity.resolve(null);
  const requested = await host.identity.requestSignIn(anon.sessionId, email);
  if (!requested.ok) {
    throw new Error(`requestSignIn failed: ${requested.reason}`);
  }
  const verified = await host.identity.verifySignIn(anon.sessionId, mailer.lastCode());
  if (!verified.ok) {
    throw new Error("verifySignIn failed");
  }
  return {
    cookie: `${SESSION_COOKIE_NAME}=${verified.issuedToken.value}`,
    userId: verified.userId,
    sessionId: anon.sessionId,
  };
}
