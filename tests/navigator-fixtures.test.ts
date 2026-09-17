/** @vitest-environment happy-dom */

import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listNavigatorFixtureFiles,
  loadNavigatorFixture,
  runNavigatorFixture,
} from "./helpers/navigatorFixture.ts";

describe("shared Navigator fixtures", () => {
  const files = listNavigatorFixtureFiles();

  it("finds scenario and decode JSON files", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => basename(f))).toContain("open-bootstrap.json");
  });

  for (const file of files) {
    it(basename(file, ".json"), async () => {
      const fixture = loadNavigatorFixture(file);
      await runNavigatorFixture(fixture);
    });
  }
});
