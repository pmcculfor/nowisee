import type { StackEntry } from "./types.ts";

/**
 * Per-current-app navigation stack. Tip = last entry.
 * Cleared on every openLocation (Navigator).
 */
export class Stack {
  private entries: StackEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  tip(): StackEntry | null {
    if (this.entries.length === 0) {
      return null;
    }
    return this.entries[this.entries.length - 1]!;
  }

  push(entry: StackEntry): void {
    this.entries.push(entry);
  }

  replaceTip(entry: StackEntry): void {
    if (this.entries.length === 0) {
      this.entries.push(entry);
      return;
    }
    this.entries[this.entries.length - 1] = entry;
  }

  pop(): StackEntry | null {
    return this.entries.pop() ?? null;
  }

  clear(): void {
    this.entries = [];
  }

  snapshot(): readonly StackEntry[] {
    return this.entries.slice();
  }
}
