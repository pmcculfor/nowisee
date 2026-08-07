export const NOTES_APP_ID = "notes";

export const CREATE_NODE_ID = "notes:create";
export const CREATE_EDIT_NODE_ID = "notes:create:edit";
/** Landing tip for create-action before the result repairs the tip id. */
export const CREATE_RESULT_NODE_ID = "notes:create:result";

export function noteNodeId(noteId: string): string {
  return `notes:note:${noteId}`;
}

export function noteEditNodeId(noteId: string): string {
  return `notes:note:${noteId}:edit`;
}

export function parseNoteNodeId(nodeId: string): string | null {
  const m = /^notes:note:([^:]+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function parseNoteEditNodeId(nodeId: string): string | null {
  const m = /^notes:note:([^:]+):edit$/.exec(nodeId);
  return m?.[1] ?? null;
}

/**
 * First line of the note body for list tips.
 * Empty body → a spoken placeholder so the tip is never blank.
 */
export function firstLineLabel(body: string): string {
  const line = body.split(/\r?\n/, 1)[0] ?? "";
  const trimmed = line.trim();
  return trimmed.length > 0 ? trimmed : "Empty note";
}
