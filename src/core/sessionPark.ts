import type { InputAutocomplete, NodeKind, StackEntry } from "./types.ts";

const CAP = 16;

/** One parked app session. Stack only — no warm cache or navigation map. */
export type ParkedSession = {
  readonly appId: string;
  readonly stack: readonly StackEntry[];
  readonly tipKind: NodeKind;
  readonly inputText?: string;
  readonly secret?: boolean;
  readonly autocomplete?: InputAutocomplete;
};

/**
 * In-memory MRU of other apps' stacks for this tab.
 * One snapshot per appId; `put` replaces. Navigator owns this; Recents
 * receives ids only.
 */
export class SessionPark {
  private readonly sessions = new Map<string, ParkedSession>();
  /** Most-recent first. */
  private order: string[] = [];

  put(session: ParkedSession): void {
    this.sessions.set(session.appId, session);
    this.order = [session.appId, ...this.order.filter((id) => id !== session.appId)];
    while (this.order.length > CAP) {
      const evict = this.order.pop();
      if (evict) {
        this.sessions.delete(evict);
      }
    }
  }

  peek(appId: string): ParkedSession | null {
    return this.sessions.get(appId) ?? null;
  }

  take(appId: string): ParkedSession | null {
    const session = this.sessions.get(appId);
    if (!session) {
      return null;
    }
    this.drop(appId);
    return session;
  }

  drop(appId: string): void {
    this.sessions.delete(appId);
    this.order = this.order.filter((id) => id !== appId);
  }

  list(): readonly string[] {
    return this.order.slice();
  }
}
