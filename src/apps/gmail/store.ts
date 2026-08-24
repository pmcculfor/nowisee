import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { createGmailApp, type GmailApp } from "./index.ts";
import { createGmailApiClient } from "./gmailClient.ts";
import type { ComposeDraft, GmailStore, InboxMessage, SendResult } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_GMAIL_DB_PATH = "data/apps/gmail.db";

const EMPTY_DRAFT: ComposeDraft = {
  to: "",
  subject: "",
  body: "",
  sendResult: null,
};

export type MemoryGmailStoreOptions = {
  readonly inbox?: Readonly<Record<string, readonly InboxMessage[]>>;
  readonly drafts?: Readonly<Record<string, ComposeDraft>>;
};

export function createMemoryGmailStore(options: MemoryGmailStoreOptions = {}): GmailStore {
  const inbox = new Map<string, InboxMessage[]>();
  const drafts = new Map<string, ComposeDraft>();
  for (const [owner, messages] of Object.entries(options.inbox ?? {})) {
    inbox.set(owner, [...messages]);
  }
  for (const [owner, draft] of Object.entries(options.drafts ?? {})) {
    drafts.set(owner, draft);
  }

  return {
    async listInbox(ownerId) {
      return inbox.get(ownerId) ?? [];
    },
    async replaceInbox(ownerId, messages) {
      inbox.set(ownerId, [...messages]);
    },
    async getCached(ownerId, messageId) {
      return inbox.get(ownerId)?.find((m) => m.id === messageId) ?? null;
    },
    async getDraft(ownerId) {
      return drafts.get(ownerId) ?? EMPTY_DRAFT;
    },
    async saveDraft(ownerId, patch) {
      const next: ComposeDraft = { ...(drafts.get(ownerId) ?? EMPTY_DRAFT), ...patch };
      drafts.set(ownerId, next);
      return next;
    },
    async clearDraft(ownerId) {
      drafts.delete(ownerId);
    },
  };
}

export function createSqliteGmailStore(db: Db): GmailStore {
  return {
    async listInbox(ownerId) {
      const rows = db.all<{
        message_id: string;
        from_header: string;
        subject: string;
        position: number;
      }>(
        `SELECT message_id, from_header, subject, position FROM inbox_meta
         WHERE owner_id = ?
         ORDER BY position ASC`,
        ownerId,
      );
      return rows.map(fromInboxRow);
    },
    async replaceInbox(ownerId, messages) {
      db.run("DELETE FROM inbox_meta WHERE owner_id = ?", ownerId);
      messages.forEach((message, position) => {
        db.run(
          `INSERT INTO inbox_meta (owner_id, message_id, from_header, subject, position)
           VALUES (?, ?, ?, ?, ?)`,
          ownerId,
          message.id,
          message.from,
          message.subject,
          position,
        );
      });
    },
    async getCached(ownerId, messageId) {
      const row = db.get<{
        message_id: string;
        from_header: string;
        subject: string;
        position: number;
      }>(
        `SELECT message_id, from_header, subject, position FROM inbox_meta
         WHERE owner_id = ? AND message_id = ?`,
        ownerId,
        messageId,
      );
      return row ? fromInboxRow(row) : null;
    },
    async getDraft(ownerId) {
      const row = db.get<{
        to_addr: string;
        subject: string;
        body: string;
        send_ok: number | null;
        send_message: string | null;
      }>(
        `SELECT to_addr, subject, body, send_ok, send_message FROM compose_drafts
         WHERE owner_id = ?`,
        ownerId,
      );
      if (!row) {
        return EMPTY_DRAFT;
      }
      return {
        to: row.to_addr,
        subject: row.subject,
        body: row.body,
        sendResult: sendResultFromRow(row.send_ok, row.send_message),
      };
    },
    async saveDraft(ownerId, patch) {
      const current = await this.getDraft(ownerId);
      const next: ComposeDraft = { ...current, ...patch };
      const ts = new Date().toISOString();
      db.run(
        `INSERT INTO compose_drafts (owner_id, to_addr, subject, body, send_ok, send_message, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           to_addr = excluded.to_addr,
           subject = excluded.subject,
           body = excluded.body,
           send_ok = excluded.send_ok,
           send_message = excluded.send_message,
           updated_at = excluded.updated_at`,
        ownerId,
        next.to,
        next.subject,
        next.body,
        sendOkToRow(next.sendResult),
        sendMessageToRow(next.sendResult),
        ts,
      );
      return next;
    },
    async clearDraft(ownerId) {
      db.run("DELETE FROM compose_drafts WHERE owner_id = ?", ownerId);
    },
  };
}

export function openGmailDatabase(path: string = DEFAULT_GMAIL_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_gmail.sql"] },
  });
}

export type StartGmailAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
  readonly fetch?: typeof fetch;
};

export function startGmailApp(options: StartGmailAppOptions): GmailApp {
  const db = openGmailDatabase(options.dbPath ?? DEFAULT_GMAIL_DB_PATH);
  return createGmailApp({
    rootAppId: options.rootAppId,
    store: createSqliteGmailStore(db),
    client: createGmailApiClient({ fetch: options.fetch }),
    close: () => db.close(),
  });
}

function fromInboxRow(row: {
  message_id: string;
  from_header: string;
  subject: string;
}): InboxMessage {
  return {
    id: row.message_id,
    from: row.from_header,
    subject: row.subject,
  };
}

function sendResultFromRow(ok: number | null, message: string | null): SendResult | null {
  if (ok === null) {
    return null;
  }
  if (ok === 1) {
    return { ok: true };
  }
  return { ok: false, message: message ?? "Send failed." };
}

function sendOkToRow(result: SendResult | null): number | null {
  if (!result) {
    return null;
  }
  return result.ok ? 1 : 0;
}

function sendMessageToRow(result: SendResult | null): string | null {
  if (!result || result.ok) {
    return null;
  }
  return result.message;
}
