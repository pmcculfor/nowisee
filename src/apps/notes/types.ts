/**
 * One note. No owner field yet — MVP is a single shared pool.
 * When auth arrives, add `ownerId` (or equivalent) and filter in the store;
 * the AppModule graph stays the same.
 */
export type NoteRecord = {
  readonly id: string;
  readonly body: string;
  /** ISO-8601 */
  readonly createdAt: string;
  /** ISO-8601 — list order uses this (most recently edited first). */
  readonly updatedAt: string;
};

/**
 * Persistence behind the Notes app. Core never sees this.
 * Swap LocalNotesStore / MemoryNotesStore for a remote DB adapter later.
 */
export interface NotesStore {
  list(): Promise<readonly NoteRecord[]>;
  get(id: string): Promise<NoteRecord | null>;
  create(body: string): Promise<NoteRecord>;
  update(id: string, body: string): Promise<NoteRecord | null>;
}

/** Shape persisted by the local adapter — keep versioned for migrations. */
export type NotesSnapshotV1 = {
  readonly version: 1;
  readonly notes: readonly NoteRecord[];
};

export type NotesKv = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

export function isNotesSnapshotV1(value: unknown): value is NotesSnapshotV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as { version?: unknown; notes?: unknown };
  if (v.version !== 1 || !Array.isArray(v.notes)) {
    return false;
  }
  return v.notes.every(isNoteRecord);
}

export function isNoteRecord(value: unknown): value is NoteRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.body === "string" &&
    typeof n.createdAt === "string" &&
    typeof n.updatedAt === "string"
  );
}
