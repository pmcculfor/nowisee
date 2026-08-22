import { describe, expect, it } from "vitest";
import { createAppHost } from "../server/host.ts";
import { handleAppHttp } from "../server/http.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

function host() {
  return createAppHost({ kjv: fixtureKjv, rootAppId: "home" });
}

describe("app host", () => {
  it("opens Home listing Bible and not Notes", async () => {
    const result = await host().open("home", "/", {});
    expect(result.warm.map((n) => n.label)).toEqual([
      "Bible",
      "Account",
      expect.stringContaining("Help."),
    ]);
    expect(result.node.label).toBe("Bible");
  });

  it("opens a Bible verse", async () => {
    const result = await host().open("bible", "/kjv/Genesis/1/1", {});
    expect(result.node.label).toContain("In the beginning");
    expect(result.location).toEqual({ appId: "bible", path: "/kjv/Genesis/1/1" });
  });

  it("Copy action returns clipboardText without needing a clipboard on extras", async () => {
    const result = await host().refresh(
      "bible",
      [{ nodeId: "bible:s:Genesis:1:1:copy", label: "Copying…", location: null }],
      { action: true },
    );
    expect(result.node.label).toBe("Copied");
    expect(result.clipboardText).toContain("Genesis 1:1.");
  });
});

describe("app HTTP", () => {
  it("POST open round-trips JSON", async () => {
    const out = await handleAppHttp(host(), {
      method: "POST",
      url: "/api/apps/home/open",
      body: { path: "/" },
    });
    expect(out.status).toBe(200);
    const body = out.body as { node: { label: string } };
    expect(body.node.label).toBe("Bible");
  });

  it("unknown app is 404", async () => {
    const out = await handleAppHttp(host(), {
      method: "POST",
      url: "/api/apps/notes/open",
      body: { path: "/" },
    });
    expect(out.status).toBe(404);
  });

  it("GET is 405", async () => {
    const out = await handleAppHttp(host(), {
      method: "GET",
      url: "/api/apps/home/open",
    });
    expect(out.status).toBe(405);
  });

  it("rejects a malformed refresh stack", async () => {
    const out = await handleAppHttp(host(), {
      method: "POST",
      url: "/api/apps/bible/refresh",
      body: { stack: "nope" },
    });
    expect(out.status).toBe(400);
  });
});
