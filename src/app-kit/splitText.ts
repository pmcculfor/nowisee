const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_MIN_CHARS = 200;

/**
 * Split a body into screen-reader-sized pieces.
 * Paragraphs (blank lines) first; leftover giants split on sentences, then a hard cap.
 * Consecutive pieces pack until they reach a minimum length, so a heading is not its own node.
 * Returns at least one string (empty input → `[""]`).
 */
export function splitText(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS,
  minChars: number = DEFAULT_MIN_CHARS,
): string[] {
  const cap = maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
  const floor = Math.min(minChars > 0 ? minChars : DEFAULT_MIN_CHARS, cap);
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const pieces = paragraphs.length > 0 ? paragraphs : normalized.trim() ? [normalized.trim()] : [];
  if (pieces.length === 0) {
    return [""];
  }
  const out = pack(pieces, floor, cap, "\n\n", (oversized) => splitLong(oversized, floor, cap));
  return out.length > 0 ? out : [""];
}

function splitLong(piece: string, floor: number, cap: number): string[] {
  const sentences = piece.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  const units = (sentences.length > 1 ? sentences : [piece]).flatMap((sentence) =>
    sentence.length <= cap ? [sentence] : hardCap(sentence, cap),
  );
  return pack(units, floor, cap, " ", (oversized) => hardCap(oversized, cap));
}

function pack(
  units: readonly string[],
  floor: number,
  cap: number,
  join: string,
  splitOversized: (text: string) => string[],
): string[] {
  const out: string[] = [];
  let buf = "";

  const takeSplit = (text: string) => {
    const parts = splitOversized(text).filter((part) => part.length > 0);
    if (parts.length === 0) {
      return;
    }
    out.push(...parts.slice(0, -1));
    buf = parts[parts.length - 1]!;
  };

  const startUnit = (unit: string) => {
    if (unit.length <= cap) {
      buf = unit;
    } else {
      takeSplit(unit);
    }
  };

  for (const unit of units) {
    if (!buf) {
      startUnit(unit);
      continue;
    }
    if (buf.length < floor) {
      const candidate = buf + join + unit;
      if (candidate.length <= cap) {
        buf = candidate;
      } else {
        takeSplit(candidate);
      }
      continue;
    }
    out.push(buf);
    buf = "";
    startUnit(unit);
  }
  if (buf) {
    out.push(buf);
  }
  if (out.length < 2) {
    return out;
  }
  const last = out[out.length - 1]!;
  const prev = out[out.length - 2]!;
  if (last.length >= floor) {
    return out;
  }
  const combined = prev + join + last;
  if (combined.length > cap) {
    return out;
  }
  out[out.length - 2] = combined;
  out.pop();
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
