/**
 * One list. Owner is never on this record — every store method takes
 * `ownerId` and includes it in the query ([IDENTITY.md] §9).
 */
export type ListRecord = {
  readonly id: string;
  readonly title: string;
  /** ISO-8601 */
  readonly createdAt: string;
  /** ISO-8601 — catalog order uses this (newest first). */
  readonly updatedAt: string;
};

/**
 * One row on a list. Owner is on the parent `list` row; item queries JOIN.
 */
export type ListItemRecord = {
  readonly id: string;
  readonly listId: string;
  readonly body: string;
  /** ISO-8601 when completed; null when active. */
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ListItemFilter = "active" | "completed";

/**
 * Persistence behind the Lists app. Core never sees this.
 * The host does not inject this store; Lists opens its own SQLite file.
 */
export type FirstActiveItem = {
  readonly listId: string;
  readonly itemId: string;
  readonly body: string;
};

export interface ListsStore {
  listLists(ownerId: string): Promise<readonly ListRecord[]>;
  getList(ownerId: string, id: string): Promise<ListRecord | null>;
  createList(ownerId: string, title: string): Promise<ListRecord>;
  deleteList(ownerId: string, id: string): Promise<boolean>;
  /** Oldest active item per list — catalog `enter` targets. */
  firstActiveItems(ownerId: string): Promise<readonly FirstActiveItem[]>;

  listItems(
    ownerId: string,
    listId: string,
    filter: ListItemFilter,
  ): Promise<readonly ListItemRecord[]>;
  getItem(ownerId: string, id: string): Promise<ListItemRecord | null>;
  createItem(ownerId: string, listId: string, body: string): Promise<ListItemRecord | null>;
  completeItem(ownerId: string, id: string): Promise<ListItemRecord | null>;
  restoreItem(ownerId: string, id: string): Promise<ListItemRecord | null>;
}
