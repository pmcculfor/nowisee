import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getApp, listDirectory } from "../src/host/catalog.ts";
import { createNowiseeHost, type NowiseeHost } from "../src/host/host.ts";
import { handleSessionHttp } from "../src/host/http.ts";
import { getCanonBook } from "../src/apps/bible/catalog.ts";
import { optionId } from "../src/apps/bible/ids.ts";
import { TUTORIAL_APP_LABEL } from "../src/apps/tutorial/ids.ts";
import { startTestFleet, type TestFleet } from "./helpers/fleet.ts";

const ORIGIN = "http://localhost:5173";

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: ORIGIN,
    host: "localhost:5173",
  };
}

describe("app host", () => {
  let fleet: TestFleet;

  beforeAll(async () => {
    fleet = await startTestFleet({ rootAppId: "home", configuredOrigin: ORIGIN });
  });

  afterAll(async () => {
    await fleet.close();
  });

  it("opens Home with Tutorial first, then Bible, Notes, Lists, Weather, Account, and Manage Apps", async () => {
    const result = await fleet.rpc.open("home", "/", {});
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
    const result = await fleet.rpc.open("home", "/app/bible", {});
    expect(result.node.label).toBe("Bible");
    expect(result.location).toEqual({ appId: "home", path: "/app/bible" });
  });

  it("opens Notes signed-out as a sign-in node", async () => {
    const result = await fleet.rpc.open("notes", "/", {});
    expect(result.node.label).toBe("Sign in to use Notes.");
  });

  it("opens a Bible verse", async () => {
    const result = await fleet.rpc.open("bible", "/Genesis/1/1", {});
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
    const result = await fleet.rpc.refresh("bible", copyId, { action: { triggerId: copyId } });
    expect(result.node.label).toBe("Copied");
    expect(result.clipboardText).toContain("Genesis 1:1.");
  });

  it("opens Recents with parked ids; skips Home and unparkable Recents", async () => {
    const result = await fleet.rpc.open("recents", "/", {
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
  let fleet: TestFleet;

  beforeAll(async () => {
    fleet = await startTestFleet({ rootAppId: "home", configuredOrigin: ORIGIN });
  });

  afterAll(async () => {
    await fleet.close();
  });

  it("POST open round-trips JSON", async () => {
    const out = await handleSessionHttp(fleet.host, {
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
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/mail/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(404);
  });

  it("GET is 405", async () => {
    const out = await handleSessionHttp(fleet.host, {
      method: "GET",
      url: "/api/apps/home/open",
      headers: headers(),
    });
    expect(out.status).toBe(405);
  });

  it("rejects a refresh body that still sends stack", async () => {
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/bible/refresh",
      headers: headers(),
      body: { stack: "nope" },
    });
    expect(out.status).toBe(400);
  });

  it("rejects extras.action as a boolean", async () => {
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/bible/refresh",
      headers: headers(),
      body: { nodeId: "bible:t:OT", extras: { action: true } },
    });
    expect(out.status).toBe(400);
  });

  it("rejects extras.parkedAppIds that are not string arrays", async () => {
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/recents/open",
      headers: headers(),
      body: { path: "/", extras: { parkedAppIds: "nope" } },
    });
    expect(out.status).toBe(400);
  });
});

describe("app_catalog", () => {
  let h: NowiseeHost;

  afterEach(async () => {
    await h?.close();
  });

  it("seeds nine apps; Gmail has lockbox and OAuth; identity is Account by id", async () => {
    h = await createNowiseeHost({ rootAppId: "home" });
    const ids = listDirectory(h.db).map((d) => d.id);
    expect(ids).toEqual([
      "home",
      "recents",
      "tutorial",
      "bible",
      "notes",
      "lists",
      "weather",
      "gmail",
      "account",
    ]);
    const gmail = getApp(h.db, "gmail")!;
    expect(gmail.grantLockbox).toBe(true);
    expect(gmail.grantOauth).toBe(true);
    expect(gmail.oauthProvider?.appId).toBe("gmail");
    const notes = getApp(h.db, "notes")!;
    expect(notes.grantLockbox).toBe(false);
    expect(getApp(h.db, "home")!.grantDirectory).toBe(true);
    expect(getApp(h.db, "recents")!.parkable).toBe(false);
    expect(getApp(h.db, "account")!.homeRole).toBe("required");
    expect(h.accountAppId).toBe("account");
  });
});
