import type { Db } from "./db/index.ts";
import type { AccountFlowStore } from "../src/apps/account/types.ts";

export type { AccountFlowStore };

export function createAccountFlowStore(db: Db): AccountFlowStore {
  return {
    getEmail(sessionId) {
      const row = db.get<{ email: string | null }>(
        "SELECT email FROM account_flow WHERE session_id = ?",
        sessionId,
      );
      return row?.email ?? null;
    },
    setEmail(sessionId, email) {
      db.run(
        `INSERT INTO account_flow (session_id, email, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
        sessionId,
        email,
        Date.now(),
      );
    },
    clear(sessionId) {
      db.run("DELETE FROM account_flow WHERE session_id = ?", sessionId);
    },
  };
}
