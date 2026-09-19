import type { Mailer, MailMessage } from "./types.ts";

/** Used by ephemeral (test) hosts so a sign-in never sends real mail. */
export function createSilentMailer(): Mailer {
  return {
    async send(_message: MailMessage) {},
  };
}
