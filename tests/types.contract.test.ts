import { describe, expect, it } from "vitest";
import type { RefreshResult } from "../src/core/types.ts";

describe("RefreshResult plain-data contract", () => {
  it("survives structuredClone (message-boundary shape)", () => {
    const result: RefreshResult = {
      navigationMap: {
        "n::1": {
          next: {
            kind: "node",
            toNodeId: "n::2",
            stackBehavior: "replace",
          },
          back: {
            kind: "app",
            to: { appId: "home", path: "/" },
          },
          enter: {
            kind: "external",
            href: "https://example.com",
          },
        },
      },
      warm: [
        { id: "n::1", label: "One", kind: "text", data: { n: 1, ok: true } },
        { id: "input", label: "", kind: "input" },
      ],
      node: { id: "n::1", label: "One" },
      location: { appId: "demo", path: "/n/1" },
      clipboardText: "copy me",
    };

    const cloned = structuredClone(result);
    expect(cloned).toEqual(result);
  });
});
