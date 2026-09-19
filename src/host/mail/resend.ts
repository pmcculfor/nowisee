import type { Mailer, MailMessage } from "./types.ts";

const RESEND_URL = "https://api.resend.com/emails";

export type ResendMailerOptions = {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
};

export function createResendMailer(options: ResendMailerOptions): Mailer {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async send(message: MailMessage) {
      const response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend rejected the message (${response.status})`);
      }
    },
  };
}
