import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "navigation-geometry.json",
);

describe("shared navigation-geometry fixtures", () => {
  it("lists the six stackBehaviors and the refresh wire shape", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      stackBehaviors: string[];
      refreshWire: { body: { nodeId: string; extras: { action: { triggerId: string } } } };
      malformedEdges: { reason: string }[];
    };
    expect(raw.stackBehaviors).toEqual([
      "push",
      "replace",
      "pop",
      "stay",
      "pushTransient",
      "popTransient",
    ]);
    expect(raw.refreshWire.body).toEqual({
      nodeId: "verse",
      extras: { action: { triggerId: "pick-kjv" } },
    });
    expect(raw.malformedEdges.map((e) => e.reason)).toEqual([
      "replace-to-self",
      "pushTransient-missing-frame",
      "popTransient-on-committed-tip",
    ]);
  });
});
