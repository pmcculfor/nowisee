const DEFAULT_MAX_CHARS = 1200;

/**
 * Split a body into screen-reader-sized pieces.
 * Paragraphs (blank lines) first; leftover giants split on sentences, then a hard cap.
 * Returns at least one string (empty input → `[""]`).
 */
export function splitText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const cap = maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const pieces = paragraphs.length > 0 ? paragraphs : normalized.trim() ? [normalized.trim()] : [];
  if (pieces.length === 0) {
    return [""];
  }
  const out: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= cap) {
      out.push(piece);
    } else {
      out.push(...splitLong(piece, cap));
    }
  }
  return out.length > 0 ? out : [""];
}

function splitLong(piece: string, cap: number): string[] {
  const sentences = piece.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  const units = sentences.length > 1 ? sentences : [piece];
  const out: string[] = [];
  for (const unit of units) {
    if (unit.length <= cap) {
      out.push(unit);
    } else {
      out.push(...hardCap(unit, cap));
    }
  }
  return out;
}

function hardCap(text: string, cap: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > cap) {
    let cut = rest.lastIndexOf(" ", cap);
    if (cut < cap / 2) {
      cut = cap;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) {
    out.push(rest);
  }
  return out;
}
