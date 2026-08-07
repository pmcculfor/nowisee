import type {
  AppModule,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { NOTES_APP_ID } from "./ids.ts";
import {
  buildNotesView,
  openNotesPath,
  type NotesViewDeps,
} from "./view.ts";
import type { NotesStore } from "./types.ts";

export type NotesAppDeps = {
  readonly rootAppId: string;
  /** Injected store — memory, localStorage adapter, or a future remote DB. */
  readonly store: NotesStore;
};

/**
 * Notes as a portable AppModule.
 * List tips show the first line; enter opens an input for create/edit.
 * Persistence is entirely behind `deps.store` — not a core repository.
 */
export function createNotesApp(deps: NotesAppDeps): AppModule {
  const viewDeps: NotesViewDeps = {
    rootAppId: deps.rootAppId,
    store: deps.store,
  };

  return {
    id: NOTES_APP_ID,
    label: "Notes",
    open(path: string, _extras: RefreshExtras = {}): Promise<RefreshResult> {
      return openNotesPath(viewDeps, path);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
    ): Promise<RefreshResult> {
      const tipId = stack[stack.length - 1]?.nodeId ?? "notes:create";
      return buildNotesView(viewDeps, tipId, extras);
    },
  };
}

export type { NoteRecord, NotesStore, NotesKv, NotesSnapshotV1 } from "./types.ts";
export {
  createLocalNotesStore,
  createMemoryNotesStore,
  NOTES_STORAGE_KEY,
  sortByUpdatedDesc,
} from "./store.ts";
export { firstLineLabel, NOTES_APP_ID } from "./ids.ts";
