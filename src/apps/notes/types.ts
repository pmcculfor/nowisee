/**
 * One note. Owner is never on this record — every store method takes
 * `ownerId` and includes it in the query ([IDENTITY.md] §9).
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
 * The host does not inject this store; Notes opens its own SQLite file.
 */
export interface NotesStore {
  list(ownerId: string): Promise<readonly NoteRecord[]>;
  get(ownerId: string, id: string): Promise<NoteRecord | null>;
  create(ownerId: string, body: string): Promise<NoteRecord>;
  update(ownerId: string, id: string, body: string): Promise<NoteRecord | null>;
}
