import { afterEach, describe, expect, it } from "vitest";
import { HELP_APP_LABEL } from "../src/apps/help/ids.ts";
import { createAppHost, createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp, incomingClientClosed } from "../server/http.ts";
import type { AppModule } from "../src/core/types.ts";

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
    it("opens Home with Help first, then Bible, Notes, Account, and Manage Apps", async () => {
    const result = await host().open("home", "/", {});
    expect(result.warm.map((n) => n.label)).toEqual([
      HELP_APP_LABEL,
      "Bible",
      "Notes",
      "Account",
      "Manage Apps",
    ]);
    expect(result.node.label).toBe(HELP_APP_LABEL);
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
    const result = await host().open("bible", "/kjv/Genesis/1/1", {});
    expect(result.node.label).toContain("In the beginning");
    expect(result.location).toEqual({ appId: "bible", path: "/kjv/Genesis/1/1" });
  });

  it("Copy action returns clipboardText without needing a clipboard on extras", async () => {
    const result = await host().refresh(
      "bible",
      [{ nodeId: "bible:s:kjv:GEN:1:1:copy", label: "Copying…", location: null }],
      { action: true },
    );
    expect(result.node.label).toBe("Copied");
    expect(result.clipboardText).toContain("Genesis 1:1.");
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
    expect(body.node.label).toBe(HELP_APP_LABEL);
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

  it("rejects a malformed refresh stack", async () => {
    h = sessionHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/bible/refresh",
      headers: headers(),
      body: { stack: "nope" },
    });
    expect(out.status).toBe(400);
  });

  it("skips the app when the client already closed the request", async () => {
    let calls = 0;
    const probe: AppModule = {
      id: "probe",
      label: "Probe",
      open() {
        calls += 1;
        return {
          navigationMap: {},
          warm: [],
          node: { id: "probe:root", label: "Probe" },
          location: { appId: "probe", path: "/" },
        };
      },
      refresh() {
        calls += 1;
        return {
          navigationMap: {},
          warm: [],
          node: { id: "probe:root", label: "Probe" },
          location: { appId: "probe", path: "/" },
        };
      },
    };
    h = createNowiseeHost({
      rootAppId: "home",
      configuredOrigin: ORIGIN,
      extraApps: [probe],
    });
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/refresh",
      headers: headers(),
      body: { stack: [{ nodeId: "probe:root", label: "Probe", location: null }] },
      clientClosed: true,
    });
    expect(out.status).toBe(499);
    expect(out.body).toEqual({ error: "Aborted" });
    expect(calls).toBe(0);
  });
});

describe("incomingClientClosed", () => {
  it("is true only when the request was aborted, not merely destroyed", () => {
    expect(incomingClientClosed({ aborted: true })).toBe(true);
    expect(incomingClientClosed({ aborted: false })).toBe(false);
    expect(incomingClientClosed({})).toBe(false);
  });

  it("does not treat a fully read POST body as client-closed", async () => {
    const { createServer } = await import("node:http");
    const { readLimitedBody } = await import("../server/readBody.ts");
    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void (async () => {
          try {
            await readLimitedBody(req);
            expect(incomingClientClosed(req)).toBe(false);
            res.end("ok");
          } catch (err) {
            reject(err);
          }
        })();
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("no listen address"));
          return;
        }
        void fetch(`http://127.0.0.1:${addr.port}/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "/" }),
        })
          .then((res) => res.text())
          .then(() => {
            server.close();
            resolve();
          })
          .catch(reject);
      });
    });
  });
});
