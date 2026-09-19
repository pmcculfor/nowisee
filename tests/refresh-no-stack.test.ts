import { describe, expect, it } from "vitest";
import { startBibleApp } from "../src/apps/bible/index.ts";
import { fixtureBible } from "./helpers/kjvFixture.ts";
import { startNotesApp } from "../src/apps/notes/index.ts";
import { startListsApp } from "../src/apps/lists/index.ts";
import type { AppServerContext } from "../src/core/types.ts";

function signedOut(): AppServerContext {
  return { userId: null, sessionId: "session-1", accountAppId: "account" };
}

describe("refresh results carry no stack", () => {
  it("Bible refresh omits stack", async () => {
    const app = startBibleApp({ rootAppId: "home", dbPath: ":memory:", seed: fixtureBible });
    try {
      const opened = await app.open("/Genesis/1/1", {}, signedOut());
      expect(opened.stack?.length).toBeGreaterThan(1);
      const refreshed = await app.refresh(opened.node.id, {}, signedOut());
      expect(refreshed).not.toHaveProperty("stack");
    } finally {
      app.close();
    }
  });

  it("Notes and Lists refresh omit stack", async () => {
    const notes = startNotesApp({ rootAppId: "home", dbPath: ":memory:" });
    const lists = startListsApp({ rootAppId: "home", dbPath: ":memory:" });
    try {
      const ctx: AppServerContext = { userId: "u1", sessionId: "s1", accountAppId: "account" };
      const n = await notes.open("/", {}, ctx);
      expect(await notes.refresh(n.node.id, {}, ctx)).not.toHaveProperty("stack");
      const l = await lists.open("/", {}, ctx);
      expect(await lists.refresh(l.node.id, {}, ctx)).not.toHaveProperty("stack");
    } finally {
      notes.close();
      lists.close();
    }
  });
});
