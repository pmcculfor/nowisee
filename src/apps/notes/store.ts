import {
  isNotesSnapshotV1,
  type NoteRecord,
  type NotesKv,
  type NotesSnapshotV1,
  type NotesStore,
} from "./types.ts";

export const NOTES_STORAGE_KEY = "nowisee:notes:v1";

export type MemoryNotesStoreOptions = {
  readonly initial?: readonly NoteRecord[];
  /** Injected for tests; defaults to `crypto.randomUUID` / fallback. */
  readonly idFactory?: () => string;
  /** Injected for tests; defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
};

export type LocalNotesStoreOptions = MemoryNotesStoreOptions & {
  /** Browser `localStorage`-shaped KV. Shell supplies this — the app never imports DOM. */
  readonly kv: NotesKv;
  readonly storageKey?: string;
};

/**
 * In-memory store (tests, or a session that does not persist).
 */
export function createMemoryNotesStore(
  options: MemoryNotesStoreOptions = {},
): NotesStore {
  return createNotesStore(options);
}

/**
 * Durable browser-local store. Same rules as the memory store; persistence is
 * a wrapper around one implementation. Swap the adapter when a shared backend exists.
 */
export function createLocalNotesStore(options: LocalNotesStoreOptions): NotesStore {
  return createNotesStore(options);
}

function createNotesStore(
  options: MemoryNotesStoreOptions & {
    readonly kv?: NotesKv;
    readonly storageKey?: string;
  },
): NotesStore {
  const key = options.storageKey ?? NOTES_STORAGE_KEY;
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? (() => new Date().toISOString());
  const kv = options.kv;

  let memory = new Map<string, NoteRecord>();
  for (const n of options.initial ?? []) {
    memory.set(n.id, n);
  }

  function load(): Map<string, NoteRecord> {
    if (!kv) {
      return memory;
    }
    const raw = kv.get(key);
    if (raw === null) {
      return new Map(memory);
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isNotesSnapshotV1(parsed)) {
        return new Map(memory);
      }
      const map = new Map(memory);
      for (const n of parsed.notes) {
        map.set(n.id, n);
      }
      return map;
    } catch {
      return new Map(memory);
    }
  }

  function save(notes: Map<string, NoteRecord>): void {
    if (!kv) {
      memory = notes;
      return;
    }
    const snapshot: NotesSnapshotV1 = {
      version: 1,
      notes: sortByUpdatedDesc([...notes.values()]),
    };
    kv.set(key, JSON.stringify(snapshot));
  }

  return {
    async list() {
      return sortByUpdatedDesc([...load().values()]);
    },
    async get(id) {
      return load().get(id) ?? null;
    },
    async create(body) {
      const notes = load();
      const ts = now();
      const record: NoteRecord = {
        id: idFactory(),
        body,
        createdAt: ts,
        updatedAt: ts,
      };
      notes.set(record.id, record);
      save(notes);
      return record;
    },
    async update(id, body) {
      const notes = load();
      const existing = notes.get(id);
      if (!existing) {
        return null;
      }
      const record: NoteRecord = {
        ...existing,
        body,
        updatedAt: now(),
      };
      notes.set(id, record);
      save(notes);
      return record;
    },
  };
}

export function sortByUpdatedDesc(notes: readonly NoteRecord[]): NoteRecord[] {
  return [...notes].sort((a, b) => {
    if (a.updatedAt === b.updatedAt) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

function defaultIdFactory(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
