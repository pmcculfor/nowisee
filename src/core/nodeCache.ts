import type { NodePayload } from "./types.ts";

const DEFAULT_MAX_ENTRIES = 500;

/**
 * Client warm cache for the current app.
 * App switch clears via `clear()` (Navigator owns when).
 * Never invents fetches — only stores payloads apps returned.
 */
export class NodeCache {
  private readonly entries = new Map<string, NodePayload>();
  private readonly pinned = new Set<string>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(nodeId: string): NodePayload | undefined {
    return this.entries.get(nodeId);
  }

  clear(): void {
    this.entries.clear();
    this.pinned.clear();
  }

  /**
   * Replace warm from a refresh result, ensure tip is stored, then re-pin stack ids
   * so their payloads survive even if omitted from `warm`.
   */
  replaceWarm(warm: readonly NodePayload[], tip: NodePayload, stackIds: readonly string[]): void {
    const preserved = new Map<string, NodePayload>();
    for (const id of stackIds) {
      const existing = this.entries.get(id);
      if (existing) {
        preserved.set(id, existing);
      }
    }

    this.entries.clear();
    for (const payload of warm) {
      this.entries.set(payload.id, payload);
    }
    this.entries.set(tip.id, tip);

    for (const id of stackIds) {
      if (!this.entries.has(id)) {
        const prior = preserved.get(id);
        if (prior) {
          this.entries.set(id, prior);
        }
      }
    }

    this.pinned.clear();
    for (const id of stackIds) {
      this.pinned.add(id);
    }
    this.pinned.add(tip.id);

    this.evictIfNeeded();
  }

  /** Pin stack entry ids without replacing other warm entries. */
  pin(stackIds: readonly string[]): void {
    this.pinned.clear();
    for (const id of stackIds) {
      this.pinned.add(id);
    }
  }

  size(): number {
    return this.entries.size;
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) {
      return;
    }
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) {
        break;
      }
      if (!this.pinned.has(id)) {
        this.entries.delete(id);
      }
    }
  }
}
