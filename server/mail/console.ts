import type { Mailer, MailMessage } from "./types.ts";

export function createSilentMailer(): Mailer {
  return {
    async send(_message: MailMessage) {},
  };
}

export function createConsoleMailer(): Mailer {
  return {
    async send(message: MailMessage) {
      console.log(`Nowisee sign-in mail to ${message.to}\n${message.subject}\n\n${message.text}`);
    },
  };
}
