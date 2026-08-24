export type InboxMessage = {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
};

export type ComposeDraft = {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly sendResult: SendResult | null;
};

export type SendResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Gmail app SQLite. Owner is never on the record — every method takes ownerId.
 */
export interface GmailStore {
  listInbox(ownerId: string): Promise<readonly InboxMessage[]>;
  replaceInbox(ownerId: string, messages: readonly InboxMessage[]): Promise<void>;
  getCached(ownerId: string, messageId: string): Promise<InboxMessage | null>;
  getDraft(ownerId: string): Promise<ComposeDraft>;
  saveDraft(ownerId: string, patch: Partial<ComposeDraft>): Promise<ComposeDraft>;
  clearDraft(ownerId: string): Promise<void>;
}

export type GmailClientErrorCode = "unauthorized" | "rate-limited" | "failed";

export class GmailClientError extends Error {
  readonly code: GmailClientErrorCode;
  constructor(code: GmailClientErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GmailClientError";
    this.code = code;
  }
}

export type ListInboxOptions = {
  readonly signal?: AbortSignal;
  /** Skip metadata GET when this owner already has from/subject for the id. */
  readonly cached?: readonly InboxMessage[];
};

export interface GmailClient {
  listInbox(accessToken: string, opts?: ListInboxOptions): Promise<readonly InboxMessage[]>;
  getBody(accessToken: string, messageId: string, signal?: AbortSignal): Promise<string>;
  getProfile(accessToken: string, signal?: AbortSignal): Promise<{ email: string }>;
  send(
    accessToken: string,
    message: {
      readonly from?: string;
      readonly to: string;
      readonly subject: string;
      readonly body: string;
    },
    signal?: AbortSignal,
  ): Promise<void>;
}
