export type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export type Mailer = {
  send(message: MailMessage): Promise<void>;
};
