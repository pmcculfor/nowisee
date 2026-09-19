import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getApp, setEnabled, setGrant, setLocator, upsertApp } from "../src/host/catalog.ts";
import { createNowiseeHost } from "../src/host/host.ts";
import { handleSessionHttp } from "../src/host/http.ts";
import { generateHostSigningKeyPair } from "../src/node-kit/wireCtx.ts";
import type { AppModule, RefreshResult } from "../src/core/types.ts";
import { capturingMailer, signInForTest } from "./helpers/signIn.ts";
import { startTestFleet, type TestFleet } from "./helpers/fleet.ts";

const ORIGIN = "http://localhost:5173";

function headers(cookie?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    host: "localhost:5173",
  };
  if (cookie) {
    h.cookie = cookie;
  }
  return h;
}

function probe(id: string): AppModule {
  return {
    id,
    label: id,
    open() {
      return {
        navigationMap: {},
        warm: [],
        node: { id: `${id}:root`, label: id },
        location: { appId: id, path: "/" },
      };
    },
    refresh() {
      return {
        navigationMap: {},
        warm: [],
        node: { id: `${id}:root`, label: id },
        location: { appId: id, path: "/" },
      };
    },
  };
}

describe("sandboxed broker", () => {
  let fleet: TestFleet;

  afterEach(async () => {
    await fleet?.close();
  });

  it("disabled catalog row is 404; INSERT is visible on the next dispatch", async () => {
    fleet = await startTestFleet({
      apps: [],
      probes: [{ app: probe("probe") }],
      configuredOrigin: ORIGIN,
    });
    const h = fleet.host;
    setEnabled(h.db, "probe", false);
    const missing = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(missing.status).toBe(404);

    upsertApp(h.db, {
      appId: "late",
      locator: getApp(h.db, "home")?.locator ?? "http://127.0.0.1:9",
      label: "Late",
    });
    const lateServing = await startTestFleet({
      apps: [],
      probes: [{ app: probe("late") }],
      configuredOrigin: ORIGIN,
    });
    await lateServing.close();

    upsertApp(h.db, {
      appId: "late",
      locator: "http://127.0.0.1:1",
      label: "Late",
    });
    const stillDown = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/late/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(stillDown.status).toBe(200);
    expect((stillDown.body as RefreshResult).node.label).toBe("Late is not responding.");
  });

  it("unreachable locator returns a recovery node with back to Home", async () => {
    fleet = await startTestFleet({ apps: ["home"], configuredOrigin: ORIGIN });
    setLocator(fleet.host.db, "home", "http://127.0.0.1:1");
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(200);
    const body = out.body as RefreshResult;
    expect(body.node.label).toBe("Home is not responding.");
    expect(body.navigationMap[body.node.id]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });
  });

  it("rejects a non-loopback locator", async () => {
    fleet = await startTestFleet({ apps: ["home"], configuredOrigin: ORIGIN });
    setLocator(fleet.host.db, "home", "https://evil.example/open");
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(500);
  });

  it("Gmail with grant_oauth off is the not-configured screen", async () => {
    const mailer = capturingMailer();
    fleet = await startTestFleet({
      apps: ["gmail"],
      mailer,
      configuredOrigin: ORIGIN,
    });
    setGrant(fleet.host.db, "gmail", "grant_oauth", false);
    const alice = await signInForTest(fleet.host, mailer, "ada@example.com");
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/gmail/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    expect((out.body as RefreshResult).node.label).toBe("Gmail is not configured.");
  });

  it("wrong signing public key is treated as not responding", async () => {
    const host = await createNowiseeHost({ configuredOrigin: ORIGIN });
    const other = generateHostSigningKeyPair();
    const serving = await (await import("../src/node-kit/serve.ts")).serveApp(probe("probe"), {
      listen: "ephemeral",
      hostSigningPub: other.publicKey,
      capabilityUrl: host.capabilityOrigin,
    });
    upsertApp(host.db, {
      appId: "probe",
      locator: serving.origin,
      label: "Probe",
    });
    try {
      const out = await handleSessionHttp(host, {
        method: "POST",
        url: "/api/apps/probe/open",
        headers: headers(),
        body: { path: "/" },
      });
      expect(out.status).toBe(200);
      expect((out.body as RefreshResult).node.label).toBe("Probe is not responding.");
    } finally {
      await serving.close();
      await host.close();
    }
  });

  it("host source does not import app graphs or store openers", () => {
    const host = readFileSync(new URL("../src/host/host.ts", import.meta.url), "utf8");
    expect(host).not.toMatch(/src\/apps\/\w+\/(main|store|index)/);
    expect(host).not.toContain("firstPartyApps");
  });
});
