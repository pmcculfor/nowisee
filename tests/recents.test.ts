import { describe, expect, it } from "vitest";
import { createRecentsApp } from "../src/apps/recents/index.ts";
import { appRowId, EMPTY_NODE_ID, HOME_NODE_ID, RECENTS_APP_ID, RECENTS_APP_LABEL } from "../src/apps/recents/ids.ts";
import type { AppDescriptor, AppServerContext, RefreshResult } from "../src/core/types.ts";

const ROOT = "home";

function directory(list: AppDescriptor[]): AppServerContext {
  return {
    userId: null,
    sessionId: "test",
    accountAppId: "account",
    directory: { list: () => list },
  };
}

const PACK: AppDescriptor[] = [
  { id: "home", label: "Home", homeRole: "internal" },
  { id: "recents", label: RECENTS_APP_LABEL, homeRole: "internal", parkable: false },
  { id: "tutorial", label: "Tutorial", homeRole: "default" },
  { id: "notes", label: "Notes", homeRole: "default" },
  { id: "bible", label: "Bible", homeRole: "default" },
];

function recents() {
  return createRecentsApp({ rootAppId: ROOT });
}

function openListed(ids: readonly string[]): RefreshResult {
  return recents().open("/", { parkedAppIds: ids }, directory(PACK)) as RefreshResult;
}

describe("Recents app", () => {
  it("is labeled Recent apps", () => {
    expect(recents().id).toBe(RECENTS_APP_ID);
    expect(recents().label).toBe(RECENTS_APP_LABEL);
  });

  it("skips Home, unparkable Recents, and unknown ids; lands on the first listed row", () => {
    const result = openListed(["home", "notes", "recents", "missing", "bible"]);
    expect(result.node.id).toBe(appRowId("notes"));
    expect(result.node.label).toBe("Notes (recent)");
    expect(result.location).toBeNull();
    expect(result.warm.map((n) => n.id)).toEqual([
      EMPTY_NODE_ID,
      HOME_NODE_ID,
      appRowId("notes"),
      appRowId("bible"),
    ]);
  });

  it("landing prev is a Home node; enter there opens Home; enter on a row resumes", () => {
    const result = openListed(["home", "notes", "bible"]);
    const notesId = appRowId("notes");
    const bibleId = appRowId("bible");
    expect(result.navigationMap[notesId]?.prev).toEqual({
      kind: "node",
      toNodeId: HOME_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[HOME_NODE_ID]?.enter).toEqual({
      kind: "app",
      to: { appId: ROOT, path: "/" },
    });
    expect(result.navigationMap[HOME_NODE_ID]?.next).toEqual({
      kind: "node",
      toNodeId: notesId,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[HOME_NODE_ID]?.prev).toBeUndefined();
    expect(result.navigationMap[notesId]?.enter).toEqual({ kind: "resume", appId: "notes" });
    expect(result.navigationMap[notesId]?.back).toEqual({ kind: "resume", appId: "home" });
    expect(result.navigationMap[HOME_NODE_ID]?.back).toEqual({ kind: "resume", appId: "home" });
    expect(result.navigationMap[bibleId]?.prev).toEqual({
      kind: "node",
      toNodeId: notesId,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[bibleId]?.next).toBeUndefined();
    expect(result.navigationMap[notesId]?.next).toEqual({
      kind: "node",
      toNodeId: bibleId,
      stackBehavior: "replace",
    });
  });

  it("does not wrap prev on the Home node", () => {
    const result = openListed(["notes", "bible"]);
    expect(result.navigationMap[appRowId("notes")]?.prev).toEqual({
      kind: "node",
      toNodeId: HOME_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[HOME_NODE_ID]?.prev).toBeUndefined();
  });

  it("empty list prev is the Home node; back still resumes Home when Home is the caller", () => {
    const result = openListed(["home", "recents"]);
    expect(result.node.id).toBe(EMPTY_NODE_ID);
    expect(result.node.label).toMatch(/No recent apps/);
    expect(result.navigationMap[EMPTY_NODE_ID]?.prev).toEqual({
      kind: "node",
      toNodeId: HOME_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[HOME_NODE_ID]?.enter).toEqual({
      kind: "app",
      to: { appId: ROOT, path: "/" },
    });
    expect(result.navigationMap[HOME_NODE_ID]?.next).toEqual({
      kind: "node",
      toNodeId: EMPTY_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[EMPTY_NODE_ID]?.back).toEqual({
      kind: "resume",
      appId: "home",
    });
  });

  it("refresh keeps the Home node when it is the tip", () => {
    const result = recents().refresh(
      [{ nodeId: HOME_NODE_ID, label: "Home", location: null }],
      { parkedAppIds: ["notes"] },
      directory(PACK),
    ) as RefreshResult;
    expect(result.node.id).toBe(HOME_NODE_ID);
    expect(result.node.label).toBe("Home");
  });

  it("refresh keeps the current listed row", () => {
    const result = recents().refresh(
      [{ nodeId: appRowId("bible"), label: "Bible", location: null }],
      { parkedAppIds: ["notes", "bible"] },
      directory(PACK),
    ) as RefreshResult;
    expect(result.node.id).toBe(appRowId("bible"));
    expect(result.node.label).toBe("Bible (recent)");
  });

  it("missing directory lists nothing", () => {
    const result = recents().open("/", { parkedAppIds: ["notes"] }) as RefreshResult;
    expect(result.node.id).toBe(EMPTY_NODE_ID);
  });
});
