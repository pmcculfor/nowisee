import {
  buildMap,
  edgeNode,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  CREATE_RESULT_NODE_ID,
  firstLineLabel,
  noteEditNodeId,
  noteNodeId,
  NOTES_APP_ID,
  parseNoteEditNodeId,
  parseNoteNodeId,
} from "./ids.ts";
import type { NoteRecord, NotesStore } from "./types.ts";

export type NotesViewDeps = {
  readonly rootAppId: string;
  readonly store: NotesStore;
};

const CREATE_LABEL = "Create a note";

/**
 * Build the full list + edit graph for the current store contents.
 */
export async function buildNotesView(
  deps: NotesViewDeps,
  tipId: string,
  extras: RefreshExtras = {},
): Promise<RefreshResult> {
  // Side effects only on the action traversal that committed input text.
  if (extras.action) {
    return applyAction(deps, tipId, extras);
  }

  const notes = await deps.store.list();
  return viewFromNotes(deps, notes, tipId);
}

export async function openNotesPath(
  deps: NotesViewDeps,
  path: string,
): Promise<RefreshResult> {
  const notes = await deps.store.list();
  const tipId = tipIdForPath(path, notes);
  return viewFromNotes(deps, notes, tipId);
}

function tipIdForPath(path: string, notes: readonly NoteRecord[]): string {
  const normalized = path === "" ? "/" : path;

  if (normalized === "/create/edit") {
    return CREATE_EDIT_NODE_ID;
  }
  if (normalized === "/create") {
    return CREATE_NODE_ID;
  }

  const editMatch = /^\/note\/([^/]+)\/edit\/?$/.exec(normalized);
  if (editMatch) {
    const id = editMatch[1]!;
    if (notes.some((n) => n.id === id)) {
      return noteEditNodeId(id);
    }
    return defaultListTip(notes);
  }

  const noteMatch = /^\/note\/([^/]+)\/?$/.exec(normalized);
  if (noteMatch) {
    const id = noteMatch[1]!;
    if (notes.some((n) => n.id === id)) {
      return noteNodeId(id);
    }
    return defaultListTip(notes);
  }

  return defaultListTip(notes);
}

/**
 * Entering the app: first note if any, otherwise the create node.
 * Create sits above the list (prev from the first note).
 */
function defaultListTip(notes: readonly NoteRecord[]): string {
  if (notes.length === 0) {
    return CREATE_NODE_ID;
  }
  return noteNodeId(notes[0]!.id);
}

async function applyAction(
  deps: NotesViewDeps,
  tipId: string,
  extras: RefreshExtras,
): Promise<RefreshResult> {
  const text = extras.inputText ?? "";

  if (tipId === CREATE_RESULT_NODE_ID) {
    const created = await deps.store.create(text);
    const notes = await deps.store.list();
    return viewFromNotes(deps, notes, noteNodeId(created.id));
  }

  // Edit commit pops back onto the note tip with action + inputText.
  const noteId = parseNoteNodeId(tipId) ?? parseNoteEditNodeId(tipId);
  if (noteId) {
    try {
      await deps.store.update(noteId, text);
    } catch {
      // Stale id — fall through to default tip after reload.
    }
    const notes = await deps.store.list();
    const stillThere = notes.some((n) => n.id === noteId);
    return viewFromNotes(
      deps,
      notes,
      stillThere ? noteNodeId(noteId) : defaultListTip(notes),
    );
  }

  const notes = await deps.store.list();
  return viewFromNotes(deps, notes, defaultListTip(notes));
}

function viewFromNotes(
  deps: NotesViewDeps,
  notes: readonly NoteRecord[],
  requestedTipId: string,
): RefreshResult {
  const listIds = [CREATE_NODE_ID, ...notes.map((n) => noteNodeId(n.id))];
  const payloads = new Map<string, NodePayload>();

  payloads.set(CREATE_NODE_ID, {
    id: CREATE_NODE_ID,
    label: CREATE_LABEL,
  });
  payloads.set(CREATE_EDIT_NODE_ID, {
    id: CREATE_EDIT_NODE_ID,
    label: "",
    kind: "input",
  });
  // Warm placeholder so a warm-hit create commit can paint before refresh repairs.
  payloads.set(CREATE_RESULT_NODE_ID, {
    id: CREATE_RESULT_NODE_ID,
    label: "Saving…",
  });

  for (const note of notes) {
    const id = noteNodeId(note.id);
    payloads.set(id, {
      id,
      label: firstLineLabel(note.body),
    });
    const editId = noteEditNodeId(note.id);
    payloads.set(editId, {
      id: editId,
      label: note.body,
      kind: "input",
    });
  }

  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = defaultListTip(notes);
  }
  const tip = payloads.get(tipId)!;

  const navigationMap = buildNavigationMap(deps.rootAppId, notes, listIds);
  const warm = [...payloads.values()];

  return {
    navigationMap,
    warm,
    node: tip,
    location: locationFor(tipId),
  };
}

function buildNavigationMap(
  rootAppId: string,
  notes: readonly NoteRecord[],
  listIds: readonly string[],
): NavigationMap {
  const fragments = [
    siblingListEdges(listIds, { wrap: false }),
    // Create uses replace so the stack stays a single tip through save.
    {
      [CREATE_NODE_ID]: {
        enter: edgeNode(CREATE_EDIT_NODE_ID, "replace"),
      },
    },
    inputEdges(CREATE_EDIT_NODE_ID, {
      commitTo: CREATE_RESULT_NODE_ID,
      backTo: CREATE_NODE_ID,
      action: true,
      commitStackBehavior: "replace",
    }),
    rootBackToHome(CREATE_RESULT_NODE_ID, rootAppId),
  ];

  for (const note of notes) {
    const id = noteNodeId(note.id);
    const editId = noteEditNodeId(note.id);
    // Replace throughout so a deep-linked edit tip still has a note to return to.
    fragments.push({
      [id]: {
        enter: edgeNode(editId, "replace"),
      },
    });
    fragments.push(
      inputEdges(editId, {
        commitTo: id,
        backTo: id,
        action: true,
        commitStackBehavior: "replace",
      }),
    );
  }

  // Every list tip backs out to Home (app edge).
  for (const id of listIds) {
    fragments.push(rootBackToHome(id, rootAppId));
  }

  return buildMap(...fragments);
}

function locationFor(tipId: string): AppLocation | null {
  if (tipId === CREATE_NODE_ID) {
    return { appId: NOTES_APP_ID, path: "/create" };
  }
  if (tipId === CREATE_EDIT_NODE_ID) {
    return { appId: NOTES_APP_ID, path: "/create/edit" };
  }
  if (tipId === CREATE_RESULT_NODE_ID) {
    // Transient — keep prior address bar until tip is repaired.
    return null;
  }
  const noteId = parseNoteNodeId(tipId);
  if (noteId) {
    return { appId: NOTES_APP_ID, path: `/note/${noteId}` };
  }
  const editId = parseNoteEditNodeId(tipId);
  if (editId) {
    return { appId: NOTES_APP_ID, path: `/note/${editId}/edit` };
  }
  return { appId: NOTES_APP_ID, path: "/" };
}
