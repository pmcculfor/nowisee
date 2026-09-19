import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../server/db/index.ts";
import { handleSessionHttp } from "../server/http.ts";
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

function vaultApp(): AppModule {
  return {
    id: "vault",
    label: "Vault",
    open() {
      return {
        navigationMap: {},
        warm: [],
        node: { id: "vault:empty", label: "Empty" },
        location: { appId: "vault", path: "/" },
      };
    },
    refresh(nodeId, _extras, ctx) {
      const tip = nodeId || "";
      const match = /^vault:item:(.+)$/.exec(tip);
      const notFound: RefreshResult = {
        navigationMap: {},
        warm: [],
        node: { id: "vault:missing", label: "Not found" },
        location: { appId: "vault", path: "/" },
      };
      if (!match || !ctx?.userId) {
        return notFound;
      }
      const row = ctxDb.get<{ body: string }>(
        "SELECT body FROM vault_items WHERE id = ? AND owner_id = ?",
        match[1],
        ctx.userId,
      );
      if (!row) {
        return notFound;
      }
      return {
        navigationMap: {},
        warm: [],
        node: { id: tip, label: row.body },
        location: { appId: "vault", path: `/item/${match[1]}` },
      };
    },
  };
}

let ctxDb: ReturnType<typeof openDatabase>;

describe("owner-scoped stack ids", () => {
  let fleet: TestFleet;
  afterEach(async () => {
    await fleet?.close();
  });

  it("a forged stack node id belonging to another user returns not-found", async () => {
    ctxDb = openDatabase({ path: ":memory:" });
    ctxDb.exec(
      "CREATE TABLE vault_items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, body TEXT NOT NULL)",
    );
    const mailer = capturingMailer();
    fleet = await startTestFleet({
      db: ctxDb,
      apps: [],
      probes: [{ app: vaultApp() }],
      mailer,
      configuredOrigin: ORIGIN,
    });
    const h = fleet.host;

    const cookieA = (await signInForTest(h, mailer, "owner-a@example.com")).cookie;
    await signInForTest(h, mailer, "owner-b@example.com");

    const users = ctxDb.all<{ id: string; email: string }>("SELECT id, email FROM users ORDER BY email");
    expect(users).toHaveLength(2);
    const userA = users.find((u) => u.email === "owner-a@example.com")!;
    const userB = users.find((u) => u.email === "owner-b@example.com")!;
    ctxDb.run(
      "INSERT INTO vault_items (id, owner_id, body) VALUES (?, ?, ?)",
      "secret-a",
      userA.id,
      "Alpha private note",
    );
    ctxDb.run(
      "INSERT INTO vault_items (id, owner_id, body) VALUES (?, ?, ?)",
      "secret-b",
      userB.id,
      "Beta private note",
    );

    const own = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/vault/refresh",
      headers: headers(cookieA),
      body: {
        nodeId: "vault:item:secret-a",
      },
    });
    expect((own.body as RefreshResult).node.label).toBe("Alpha private note");

    const forged = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/vault/refresh",
      headers: headers(cookieA),
      body: {
        nodeId: "vault:item:secret-b",
      },
    });
    expect((forged.body as RefreshResult).node.label).toBe("Not found");
    expect((forged.body as RefreshResult).node.label).not.toContain("Beta");
  });
});
