import { describe, expect, it } from "vitest";
import { isRefreshResult } from "../src/core/refreshResult.ts";
import type { RefreshResult } from "../src/core/types.ts";

const ok: RefreshResult = {
  navigationMap: {
    root: {
      next: { kind: "node", toNodeId: "x", stackBehavior: "replace" },
    },
  },
  warm: [{ id: "root", label: "OK" }],
  node: { id: "root", label: "OK" },
  location: { appId: "demo", path: "/" },
};

describe("isRefreshResult", () => {
  it("accepts a well-formed result, including location null", () => {
    expect(isRefreshResult(ok)).toBe(true);
    expect(isRefreshResult({ ...ok, location: null })).toBe(true);
    expect(isRefreshResult({ ...ok, clipboardText: "copy" })).toBe(true);
  });

  it("rejects missing node, map, warm, or a non-canonical location", () => {
    expect(isRefreshResult(null)).toBe(false);
    expect(isRefreshResult({})).toBe(false);
    expect(isRefreshResult({ ...ok, node: { id: "root" } })).toBe(false);
    expect(isRefreshResult({ ...ok, navigationMap: [] })).toBe(false);
    expect(isRefreshResult({ ...ok, warm: { id: "root" } })).toBe(false);
    expect(isRefreshResult({ ...ok, location: { appId: "demo", path: "no-slash" } })).toBe(false);
    expect(isRefreshResult({ ...ok, clipboardText: 1 })).toBe(false);
  });
});
