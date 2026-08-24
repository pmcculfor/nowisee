/**
 * Search tokenizer. Split on non-letters, lowercase, unique, whole words.
 * Scope / phrase search can wrap this later; do not inline ad-hoc splitters.
 */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of text.toLowerCase().split(/[^a-z]+/)) {
    if (!part || seen.has(part)) {
      continue;
    }
    seen.add(part);
    tokens.push(part);
  }
  return tokens;
}
