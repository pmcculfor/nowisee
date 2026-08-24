export const GMAIL_APP_ID = "gmail";
export const GMAIL_APP_LABEL = "Gmail";
export const GMAIL_OAUTH_SLOT = "personal";

export const NODE = {
  connect: "gmail:connect",
  disconnect: "gmail:disconnect",
  disconnectStatus: "gmail:disconnect:status",
  compose: "gmail:compose",
  composeTo: "gmail:compose:to",
  composeSubject: "gmail:compose:subject",
  composeBody: "gmail:compose:body",
  composeSent: "gmail:compose:sent",
  unavailable: "gmail:unavailable",
  loadError: "gmail:error",
} as const;

export function messageNodeId(messageId: string): string {
  return `gmail:msg:${messageId}`;
}

export function parseMessageNodeId(nodeId: string): string | null {
  const m = /^gmail:msg:([^:]+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function chunkNodeId(messageId: string, index: number): string {
  return `gmail:msg:${messageId}:p:${index}`;
}

export function parseChunkNodeId(
  nodeId: string,
): { readonly messageId: string; readonly index: number } | null {
  const m = /^gmail:msg:([^:]+):p:(\d+)$/.exec(nodeId);
  if (!m) {
    return null;
  }
  return { messageId: m[1]!, index: Number(m[2]) };
}

export function subjectLabel(from: string, subject: string): string {
  const who = displayFrom(from);
  const sub = subject.trim() || "No subject";
  return who ? `${who} — ${sub}` : sub;
}

/** Visible name from a From header (`Name <a@b>` → Name). */
export function displayFrom(from: string): string {
  const trimmed = from.trim();
  if (!trimmed) {
    return "";
  }
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(trimmed);
  if (named) {
    return named[1]!.trim();
  }
  return trimmed;
}
