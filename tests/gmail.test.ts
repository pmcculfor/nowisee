import { afterEach, describe, expect, it } from "vitest";
import { edgeApp, edgeExternal, edgePop } from "../src/app-kit/index.ts";
import { createGmailApp, type GmailApp } from "../src/apps/gmail/index.ts";
import {
  chunkNodeId,
  GMAIL_APP_ID,
  messageNodeId,
  NODE,
} from "../src/apps/gmail/ids.ts";
import { createGmailApiClient } from "../src/apps/gmail/gmailClient.ts";
import { decodeBase64Url, encodeRawMessage, extractPlainText } from "../src/apps/gmail/mime.ts";
import {
  createSqliteGmailStore,
  openGmailDatabase,
  startGmailApp,
} from "../src/apps/gmail/store.ts";
import {
  GmailClientError,
  type GmailClient,
  type InboxMessage,
} from "../src/apps/gmail/types.ts";
import { OAuthError } from "../server/oauth/errors.ts";
import type { AppServerContext, OAuthCapability, OAuthConnectionStatus } from "../src/core/types.ts";

const OWNER = "user-1";
const OTHER = "user-2";
const CONNECT_HREF = "https://accounts.google.com/o/oauth2/v2/auth?state=s";

function signedOutCtx(): AppServerContext {
  return { userId: null, sessionId: "session-1", accountAppId: "account" };
}

function mockOauth(initial: OAuthConnectionStatus = "ready"): OAuthCapability & {
  disconnects: number;
} {
  let status = initial;
  const cap: OAuthCapability & { disconnects: number } = {
    disconnects: 0,
    async start() {
      return { authorizeUrl: CONNECT_HREF };
    },
    async status() {
      return status;
    },
    async getAccessToken() {
      if (status !== "ready") {
        throw new OAuthError("needs-reconnect");
      }
      return "tok";
    },
    async disconnect() {
      cap.disconnects += 1;
      status = "missing";
    },
  };
  return cap;
}

function signedIn(
  oauth: OAuthCapability,
  userId: string = OWNER,
): AppServerContext {
  return { userId, sessionId: "session-1", accountAppId: "account", oauth };
}

function fakeClient(options: {
  readonly inbox?: readonly InboxMessage[];
  readonly bodies?: Readonly<Record<string, string>>;
  readonly send?: (message: {
    readonly from?: string;
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  }) => void;
  readonly failList?: boolean;
}): GmailClient {
  return {
    async listInbox() {
      if (options.failList) {
        throw new GmailClientError("failed");
      }
      return options.inbox ?? [];
    },
    async getBody(_token, id) {
      return options.bodies?.[id] ?? `Body of ${id}.`;
    },
    async getProfile() {
      return { email: "me@gmail.com" };
    },
    async send(_token, message) {
      options.send?.(message);
    },
  };
}

const opened: GmailApp[] = [];

afterEach(() => {
  for (const gmail of opened) {
    gmail.close();
  }
  opened.length = 0;
});

function app(client: GmailClient = fakeClient({})) {
  const db = openGmailDatabase(":memory:");
  const gmail = createGmailApp({
    rootAppId: "home",
    store: createSqliteGmailStore(db),
    client,
    close: () => db.close(),
  });
  opened.push(gmail);
  return gmail;
}

describe("Gmail app graph", () => {
  it("signed out offers Account", async () => {
    const result = await app().open("/", {}, signedOutCtx());
    expect(result.node.label).toBe("Sign in to use Gmail.");
    expect(result.navigationMap[result.node.id]?.enter).toEqual(
      edgeApp({ appId: "account", path: "/" }),
    );
  });

  it("missing oauth grant is an ordinary node", async () => {
    const result = await app().open("/", {}, {
      userId: OWNER,
      sessionId: "s",
      accountAppId: "account",
    });
    expect(result.node.id).toBe(NODE.unavailable);
    expect(result.node.label).toBe("Gmail is not configured.");
  });

  it("unconnected enter is an external Google URL", async () => {
    const oauth = mockOauth("missing");
    const result = await app().open("/", {}, signedIn(oauth));
    expect(result.node.id).toBe(NODE.connect);
    expect(result.navigationMap[NODE.connect]?.enter).toEqual(edgeExternal(CONNECT_HREF));
    expect(result.location).toEqual({ appId: GMAIL_APP_ID, path: "/connect" });
  });

  it("empty inbox tips Compose; Compose is prev of the first subject", async () => {
    const oauth = mockOauth();
    const empty = await app().open("/", {}, signedIn(oauth));
    expect(empty.node.id).toBe(NODE.compose);
    expect(empty.node.label).toBe("Compose");
    expect(empty.navigationMap[NODE.compose]?.prev).toMatchObject({
      kind: "node",
      toNodeId: NODE.disconnect,
    });

    const withMail = app(
      fakeClient({
        inbox: [
          { id: "m1", from: "Ada <ada@x>", subject: "Hello" },
          { id: "m2", from: "Bob", subject: "Later" },
        ],
      }),
    );
    const opened = await withMail.open("/", {}, signedIn(oauth));
    expect(opened.node.id).toBe(messageNodeId("m1"));
    expect(opened.node.label).toBe("Hello. From Ada");
    expect(opened.navigationMap[messageNodeId("m1")]?.prev).toMatchObject({
      toNodeId: NODE.compose,
    });
    expect(opened.navigationMap[NODE.compose]?.next).toMatchObject({
      toNodeId: messageNodeId("m1"),
    });
    expect(opened.navigationMap[messageNodeId("m2")]?.next).toBeUndefined();
  });

  it("enter on a subject pushes body chunks; back pops; no reply", async () => {
    const oauth = mockOauth();
    const gmail = app(
      fakeClient({
        inbox: [{ id: "m1", from: "Ada", subject: "Hello" }],
        bodies: { m1: "First paragraph.\n\nSecond paragraph." },
      }),
    );
    const inbox = await gmail.open("/", {}, signedIn(oauth));
    expect(inbox.navigationMap[messageNodeId("m1")]?.enter).toMatchObject({
      toNodeId: chunkNodeId("m1", 0),
      stackBehavior: "push",
    });
    const body = await gmail.open("/msg/m1/p/0", {}, signedIn(oauth));
    expect(body.node.label).toBe("First paragraph.");
    expect(body.navigationMap[chunkNodeId("m1", 0)]?.next).toMatchObject({
      toNodeId: chunkNodeId("m1", 1),
    });
    expect(body.navigationMap[chunkNodeId("m1", 0)]?.back).toEqual(edgePop());
    expect(body.navigationMap[chunkNodeId("m1", 0)]?.enter).toBeUndefined();
  });

  it("compose shows an instruction node before each input", async () => {
    const oauth = mockOauth();
    const gmail = app();
    const ctx = signedIn(oauth);
    const compose = await gmail.open("/compose", {}, ctx);
    expect(compose.navigationMap[NODE.compose]?.enter).toMatchObject({
      toNodeId: NODE.composeToPrompt,
    });

    const toPrompt = await gmail.open("/compose/to", {}, ctx);
    expect(toPrompt.node.label).toBe("Enter the recipient's email on the next screen.");
    expect(toPrompt.navigationMap[NODE.composeToPrompt]?.enter).toMatchObject({
      toNodeId: NODE.composeTo,
    });
    expect(toPrompt.navigationMap[NODE.composeTo]?.enter).toMatchObject({
      toNodeId: NODE.composeSubjectPrompt,
    });

    const subjectPrompt = await gmail.open("/compose/subject", {}, ctx);
    expect(subjectPrompt.node.label).toBe("Enter the subject on the next screen.");
    expect(subjectPrompt.navigationMap[NODE.composeSubjectPrompt]?.enter).toMatchObject({
      toNodeId: NODE.composeSubject,
    });
    expect(subjectPrompt.navigationMap[NODE.composeSubject]?.enter).toMatchObject({
      toNodeId: NODE.composeBodyPrompt,
    });

    const bodyPrompt = await gmail.open("/compose/body", {}, ctx);
    expect(bodyPrompt.node.label).toBe("Enter the body on the next screen.");
    expect(bodyPrompt.navigationMap[NODE.composeBodyPrompt]?.enter).toMatchObject({
      toNodeId: NODE.composeBody,
    });
  });

  it("compose To→Subject→Body send stays on Sent and does not teleport", async () => {
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    const oauth = mockOauth();
    const gmail = app(fakeClient({ inbox: [], send: (m) => sent.push(m) }));
    const ctx = signedIn(oauth);

    await gmail.refresh(
      [{ nodeId: NODE.composeSubjectPrompt, label: "", location: null }],
      { action: true, inputText: "ada@example.com" },
      ctx,
    );
    await gmail.refresh(
      [{ nodeId: NODE.composeBodyPrompt, label: "", location: null }],
      { action: true, inputText: "Hi" },
      ctx,
    );
    const result = await gmail.refresh(
      [{ nodeId: NODE.composeSent, label: "Sending…", location: null }],
      { action: true, inputText: "Hello Ada" },
      ctx,
    );
    expect(sent).toEqual([{ to: "ada@example.com", subject: "Hi", body: "Hello Ada", from: "me@gmail.com" }]);
    expect(result.node.id).toBe(NODE.composeSent);
    expect(result.node.label).toBe("Sent.");
    expect(result.location).toBeNull();
    expect(result.navigationMap[NODE.composeSent]?.back).toMatchObject({
      toNodeId: NODE.compose,
    });
  });

  it("send without To stays on Sent with an error; does not call send", async () => {
    let called = 0;
    const oauth = mockOauth();
    const gmail = app(fakeClient({ send: () => { called += 1; } }));
    const result = await gmail.refresh(
      [{ nodeId: NODE.composeSent, label: "Sending…", location: null }],
      { action: true, inputText: "body" },
      signedIn(oauth),
    );
    expect(called).toBe(0);
    expect(result.node.label).toBe("Send failed. To address is missing.");
  });

  it("unknown message id falls back to the inbox tip", async () => {
    const oauth = mockOauth();
    const gmail = app(
      fakeClient({ inbox: [{ id: "m1", from: "Ada", subject: "Hello" }] }),
    );
    const result = await gmail.open("/msg/not-yours", {}, signedIn(oauth));
    expect(result.node.id).toBe(messageNodeId("m1"));
  });

  it("disconnect action revokes and does not list mail", async () => {
    const oauth = mockOauth();
    const gmail = app(
      fakeClient({ inbox: [{ id: "m1", from: "Ada", subject: "Hello" }] }),
    );
    const ctx = signedIn(oauth);
    const done = await gmail.refresh(
      [{ nodeId: NODE.disconnectStatus, label: "Disconnecting…", location: null }],
      { action: true },
      ctx,
    );
    expect(oauth.disconnects).toBe(1);
    expect(done.node.label).toBe("Gmail disconnected.");
    const next = await gmail.open("/", {}, ctx);
    expect(next.node.id).toBe(NODE.connect);
  });

  it("needs-reconnect shows Connect", async () => {
    const result = await app().open("/", {}, signedIn(mockOauth("needs-reconnect")));
    expect(result.node.id).toBe(NODE.connect);
  });
});

describe("Gmail mime", () => {
  it("prefers text/plain over html", () => {
    const text = extractPlainText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("plain body").toString("base64url") } },
        { mimeType: "text/html", body: { data: Buffer.from("<b>html</b>").toString("base64url") } },
      ],
    });
    expect(text).toBe("plain body");
  });

  it("strips html when that is all there is", () => {
    const text = extractPlainText({
      mimeType: "text/html",
      body: { data: Buffer.from("<p>Hi<br>there</p><script>x()</script>").toString("base64url") },
    });
    expect(text).toContain("Hi");
    expect(text).toContain("there");
    expect(text).not.toContain("script");
  });

  it("encodes a send payload as base64url RFC 2822", () => {
    const raw = encodeRawMessage({
      from: "me@gmail.com",
      to: "ada@example.com",
      subject: "Hi",
      body: "Hello",
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("To: ada@example.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Hello");
    expect(decoded).toContain("\r\n");
  });
});

describe("Gmail REST client", () => {
  it("lists metadata then gets a body; send posts raw; 401 is unauthorized", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/messages?") && url.includes("INBOX")) {
        return json({ messages: [{ id: "m1" }] });
      }
      if (url.includes("/messages/m1?") && url.includes("metadata")) {
        return json({
          id: "m1",
          payload: {
            headers: [
              { name: "From", value: "Ada <ada@x>" },
              { name: "Subject", value: "Hello" },
            ],
          },
        });
      }
      if (url.includes("/messages/m1?") && url.includes("full")) {
        return json({
          payload: {
            mimeType: "text/plain",
            body: { data: Buffer.from("Hi there").toString("base64url") },
          },
        });
      }
      if (url.endsWith("/messages/send")) {
        const body = JSON.parse(String(init?.body)) as { raw: string };
        expect(decodeBase64Url(body.raw)).toContain("To: ada@example.com");
        return json({ id: "sent-1" });
      }
      if (url.endsWith("/profile")) {
        return json({ emailAddress: "me@gmail.com" });
      }
      return new Response("", { status: 404 });
    };
    const client = createGmailApiClient({ fetch: fetchFn, delay: async () => undefined });
    const listed = await client.listInbox("tok");
    expect(listed).toEqual([{ id: "m1", from: "Ada <ada@x>", subject: "Hello" }]);
    expect(await client.getBody("tok", "m1")).toBe("Hi there");
    await client.send("tok", { to: "ada@example.com", subject: "Hi", body: "x" });

    const unauth: typeof fetch = async () => new Response("", { status: 401 });
    await expect(createGmailApiClient({ fetch: unauth }).listInbox("tok")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(calls.some((c) => c.startsWith("POST"))).toBe(true);
  });

  it("retries GET on 429 and does not retry send", async () => {
    let gets = 0;
    let posts = 0;
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        posts += 1;
        return new Response("", { status: 429 });
      }
      gets += 1;
      if (gets < 2) {
        return new Response("", { status: 429 });
      }
      if (url.includes("/messages?")) {
        return json({ messages: [] });
      }
      return json({});
    };
    const client = createGmailApiClient({ fetch: fetchFn, delay: async () => undefined });
    expect(await client.listInbox("tok")).toEqual([]);
    expect(gets).toBe(2);
    await expect(client.send("tok", { to: "a@b.c", subject: "", body: "" })).rejects.toMatchObject({
      code: "rate-limited",
    });
    expect(posts).toBe(1);
  });
});

describe("Gmail sqlite store", () => {
  it("scopes inbox rows by owner", async () => {
    const db = openGmailDatabase(":memory:");
    const store = createSqliteGmailStore(db);
    await store.replaceInbox(OWNER, [{ id: "m1", from: "Ada", subject: "Hi" }]);
    expect(await store.listInbox(OTHER)).toEqual([]);
    expect(await store.getCached(OTHER, "m1")).toBeNull();
    expect((await store.listInbox(OWNER))[0]?.id).toBe("m1");
    db.close();
  });

  it("startGmailApp signed-out does not call Google", async () => {
    const gmail = startGmailApp({ rootAppId: "home", dbPath: ":memory:" });
    const result = await gmail.open("/", {}, signedOutCtx());
    expect(result.node.label).toBe("Sign in to use Gmail.");
    gmail.close();
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
