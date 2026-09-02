/**
 * Persistence behind Home's per-user list. Core never sees this.
 * The host does not inject this store; Home opens its own SQLite file.
 * Owner is never on a row type — every method takes `ownerId` ([IDENTITY.md] §9).
 */
export interface HomeStore {
  /** Ordered app ids for this owner. Empty means "use default ∪ required". */
  list(ownerId: string): Promise<readonly string[]>;
  /** Replace the owner's explicit ordered set. */
  save(ownerId: string, appIds: readonly string[]): Promise<void>;
}
