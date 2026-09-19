import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCanonBook } from "../src/apps/bible/catalog.ts";
import { optionId } from "../src/apps/bible/ids.ts";
import { TUTORIAL_APP_LABEL } from "../src/apps/tutorial/ids.ts";
import { startFirstPartyApps, type FirstPartyCatalog } from "../server/firstPartyApps.ts";
import { createAppHost, createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";

const ORIGIN = "http://localhost:5173";

function host() {
  return createAppHost({ rootAppId: "home" });
}

function sessionHost(): NowiseeHost {
  return createNowiseeHost({
    rootAppId: "home",
    configuredOrigin: ORIGIN,
  });
}

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: ORIGIN,
    host: "localhost:5173",
  };
}

describe("app host", () => {
    it("opens Home with Tutorial first, then Bible, Notes, Lists, Weather, Account, and Manage Apps", async () => {
    const result = await host().open("home", "/", {});
    expect(result.warm.map((n) => n.label)).toEqual([
      TUTORIAL_APP_LABEL,
      "Bible",
      "Notes",
      "Lists",
      "Weather",
      "Account",
      "Manage Apps",
    ]);
    expect(result.node.label).toBe(TUTORIAL_APP_LABEL);
  });

  it("open Home /app/bible lands on the Bible catalog row", async () => {
    const result = await host().open("home", "/app/bible", {});
    expect(result.node.label).toBe("Bible");
    expect(result.location).toEqual({ appId: "home", path: "/app/bible" });
  });

  it("opens Notes signed-out as a sign-in node", async () => {
    const result = await host().open("notes", "/", {});
    expect(result.node.label).toBe("Sign in to use Notes.");
  });

  it("opens a Bible verse", async () => {
    const result = await host().open("bible", "/Genesis/1/1", {});
    expect(result.node.label).toContain("In the beginning");
    expect(result.location).toEqual({ appId: "bible", path: "/Genesis/1/1" });
  });

  it("Copy action returns clipboardText without needing a clipboard on extras", async () => {
    const copyId = optionId(
            {
              bookId: getCanonBook("GEN")!.sort,
              chapter: 1,
              verse: 1,
            },
            "copy",
          );
    const result = await host().refresh(
      "bible",
      copyId,
      { action: { triggerId: copyId } },
    );
    expect(result.node.label).toBe("Copied");
    expect(result.clipboardText).toContain("Genesis 1:1.");
  });

  it("opens Recents with parked ids; skips Home and unparkable Recents", async () => {
    const result = await host().open("recents", "/", {
      parkedAppIds: ["home", "notes", "recents"],
    });
    expect(result.node.label).toBe("Notes (recent)");
    expect(result.location).toBeNull();
    expect(result.navigationMap[result.node.id]?.enter).toEqual({
      kind: "resume",
      appId: "notes",
    });
    expect(result.navigationMap[result.node.id]?.prev).toEqual({
      kind: "node",
      toNodeId: "recents:home",
      stackBehavior: "replace",
    });
    expect(result.navigationMap[result.node.id]?.back).toEqual({
      kind: "resume",
      appId: "home",
    });
  });
});

describe("app HTTP", () => {
  let h: NowiseeHost;
  afterEach(() => {
    h?.close();
  });

  it("POST open round-trips JSON", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(200);
    const body = out.body as { node: { label: string } };
    expect(body.node.label).toBe(TUTORIAL_APP_LABEL);
  });

  it("unknown app is 404", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/mail/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(404);
  });

  it("GET is 405", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "GET",
      url: "/api/apps/home/open",
      headers: headers(),
    });
    expect(out.status).toBe(405);
  });

  it("rejects a refresh body that still sends stack", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/bible/refresh",
      headers: headers(),
      body: { stack: "nope" },
    });
    expect(out.status).toBe(400);
  });

  it("rejects extras.action as a boolean", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/bible/refresh",
      headers: headers(),
      body: { nodeId: "bible:t:OT", extras: { action: true } },
    });
    expect(out.status).toBe(400);
  });

  it("rejects extras.parkedAppIds that are not string arrays", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/recents/open",
      headers: headers(),
      body: { path: "/", extras: { parkedAppIds: "nope" } },
    });
    expect(out.status).toBe(400);
  });
});

/**
 * The running host derives its grant lists from the same pack rows, but skips
 * them when `ephemeral` is true, so no session test ever reads them. These cover
 * the derivation itself.
 */
describe("first-party catalog", () => {
  let catalog: FirstPartyCatalog;

  beforeEach(() => {
    catalog = startFirstPartyApps({ rootAppId: "home", ephemeral: true });
  });

  afterEach(() => {
    for (const app of catalog.apps) {
      app.close?.();
    }
  });

  it("grants lockbox and OAuth to Gmail and to no one else", () => {
    expect(catalog.lockbox).toEqual(["gmail"]);
    expect(catalog.oauth).toEqual(["gmail"]);
    expect(catalog.providers.map((p) => p.appId)).toEqual(["gmail"]);
  });

  it("grants identity to Account and the directory to Home and Recents", () => {
    expect(catalog.identity).toEqual(["account"]);
    expect(catalog.directory).toEqual(["home", "recents"]);
  });

  it("reads every grant off the row that started the app", () => {
    const ids = catalog.apps.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const list of [catalog.identity, catalog.lockbox, catalog.oauth, catalog.directory]) {
      for (const id of list) {
        expect(ids).toContain(id);
      }
    }
    expect(catalog.homeRoleByAppId.get("account")).toBe("required");
    expect(catalog.parkableByAppId.get("recents")).toBe(false);
  });
});
