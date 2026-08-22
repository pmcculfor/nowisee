import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { CREATE_NODE_ID, NOTES_APP_ID } from "./ids.ts";
import {
  buildNotesView,
  openNotesPath,
  type NotesViewDeps,
} from "./view.ts";
import type { NotesStore } from "./types.ts";

export type NotesAppDeps = {
  readonly rootAppId: string;
  readonly store: NotesStore;
  readonly close?: () => void;
};

export type NotesApp = AppModule & { close(): void };

/**
 * Notes as a portable AppModule.
 * List tips show the first line; enter opens an input for create/edit.
 * Persistence is entirely behind `deps.store` — not a core repository.
 * Signed-out (`ctx.userId` null) is a sign-in node; no notes are created.
 */
export function createNotesApp(deps: NotesAppDeps): NotesApp {
  const viewDeps: NotesViewDeps = {
    rootAppId: deps.rootAppId,
    store: deps.store,
  };

  return {
    id: NOTES_APP_ID,
    label: "Notes",
    open(path: string, _extras: RefreshExtras = {}, ctx?: AppServerContext): Promise<RefreshResult> {
      return openNotesPath(viewDeps, path, ctx);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      const tipId = stack[stack.length - 1]?.nodeId ?? CREATE_NODE_ID;
      return buildNotesView(viewDeps, tipId, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { NoteRecord, NotesStore } from "./types.ts";
export { firstLineLabel, NOTES_APP_ID } from "./ids.ts";
