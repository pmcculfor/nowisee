import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AppRpc, RefreshExtras, RefreshResult, WireExtras } from "../core/types.ts";
import {
  descriptorsToWire,
  generateHostSigningKeyPair,
  publicKeyFromPrivate,
  signWireCtx,
  WIRE_API_VERSION,
  WIRE_CTX_TTL_MS,
  type UnsignedWireCtx,
} from "../node-kit/wireCtx.ts";
import { getApp, listDirectory } from "./catalog.ts";
import type { CapabilityTicket } from "./capabilities/http.ts";
import { startCapabilityServer } from "./capabilities/http.ts";
import type { Db } from "./db/index.ts";
import { openDatabase } from "./db/index.ts";
import { AppNotFoundError } from "./errors.ts";
import type { CookieSlot } from "./identity/context.ts";
import { createIdentityService, type IdentityService } from "./identity/service.ts";
import { parseListenAddress } from "../node-kit/listenHttp.ts";
import { lockboxKeyringFromEnv, type LockboxKeyring } from "./lockbox/crypto.ts";
import {
  createSilentMailer,
  mailerFromEnv,
  otpPepperFromEnv,
  type Mailer,
} from "./mail/index.ts";
import { createLockboxService, type LockboxService } from "./lockbox/service.ts";
import { createOAuthBroker, type OAuthBroker } from "./oauth/broker.ts";
import { envOAuthSecrets, type OAuthSecrets } from "./oauth/secrets.ts";
import { recordUsage, usageKind } from "./usage.ts";

/** Fixed pepper for ephemeral (test) hosts, which never send real mail. */
const EPHEMERAL_OTP_PEPPER = new Uint8Array(32).fill(1);
const EPHEMERAL_LOCKBOX_KEY = new Uint8Array(32).fill(7);
const DISPATCH_TIMEOUT_MS = 30_000;

export type AppHostOptions = {
  readonly rootAppId?: string;
  readonly accountAppId?: string;
  /** Host identity database, or a file path. Default `:memory:`. */
  readonly db?: Db | string;
  /**
   * When true (the default), use the test lockbox keyring and OTP pepper.
   * Production must pass `false`.
   */
  readonly ephemeral?: boolean;
  readonly allowRegistration?: boolean;
  readonly lockboxKeys?: LockboxKeyring;
  readonly oauthSecrets?: OAuthSecrets;
  readonly fetch?: typeof fetch;
  readonly configuredOrigin?: string;
  readonly mailer?: Mailer;
  readonly otpPepper?: Uint8Array;
  /** Normalized emails allowed to open /admin. Empty (the default) disables it. */
  readonly adminEmails?: readonly string[];
  /** `127.0.0.1:3020`. Omit in tests for an ephemeral loopback port. */
  readonly capabilityListen?: string;
  /** PKCS8 DER, base64. Omit in tests to mint a keypair. */
  readonly hostSigningKey?: string;
};

export type NowiseeHost = {
  readonly rootAppId: string;
  readonly accountAppId: string;
  readonly configuredOrigin: string | undefined;
  readonly identity: IdentityService;
  readonly oauth?: OAuthBroker;
  readonly db: Db;
  readonly capabilityOrigin: string;
  readonly hostSigningPublicKey: string;
  isAdmin(userId: string | null): boolean;
  open(appId: string, path: string, extras: WireExtras): Promise<RefreshResult>;
  refresh(appId: string, nodeId: string, extras: WireExtras): Promise<RefreshResult>;
  /**
   * Resolve the session, sign ctx, POST the app locator, and record any issued
   * cookie on `slot`. Used by the HTTP layer.
   */
  dispatch(
    kind: "open" | "refresh",
    args: {
      readonly appId: string;
      readonly path?: string;
      readonly nodeId?: string;
      readonly extras: WireExtras;
      readonly token: string | null;
      readonly slot: CookieSlot;
      readonly clientIp?: string;
    },
  ): Promise<RefreshResult>;
  close(): Promise<void>;
};

export async function createNowiseeHost(options: AppHostOptions = {}): Promise<NowiseeHost> {
  const rootAppId = options.rootAppId ?? "home";
  const accountAppId = options.accountAppId ?? "account";
  const ephemeral = options.ephemeral ?? true;
  const db = resolveDb(options.db);

  const mailer =
    options.mailer ??
    (ephemeral ? createSilentMailer() : mailerFromEnv({ fetch: options.fetch }));
  const otpPepper =
    options.otpPepper ?? (ephemeral ? EPHEMERAL_OTP_PEPPER : otpPepperFromEnv());
  const adminEmails = new Set(
    (options.adminEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean),
  );
  const identity = createIdentityService({
    db,
    mailer,
    otpPepper,
    allowRegistration: options.allowRegistration,
  });

  const signingPrivate =
    options.hostSigningKey ??
    (ephemeral ? generateHostSigningKeyPair().privateKey : requiredEnv("NOWISEE_HOST_SIGNING_KEY"));
  const hostSigningPublicKey = publicKeyFromPrivate(signingPrivate);

  const keyring =
    options.lockboxKeys ?? lockboxKeyringFromEnv() ?? (ephemeral ? ephemeralLockboxKeyring() : undefined);
  if (!keyring) {
    throw new Error("NOWISEE_LOCKBOX_KEY is required when the catalog grants lockbox or OAuth");
  }
  const lockbox: LockboxService = createLockboxService({ db, keyring });

  let oauth: OAuthBroker | undefined;
  if (options.configuredOrigin) {
    oauth = createOAuthBroker({
      db,
      lockbox,
      keyring,
      getProvider: (appId) => getApp(db, appId)?.oauthProvider,
      secrets: options.oauthSecrets ?? envOAuthSecrets(),
      configuredOrigin: options.configuredOrigin,
      fetch: options.fetch,
    });
  }

  const tickets = new Map<string, CapabilityTicket>();
  let closed = false;
  const capListen = options.capabilityListen
    ? parseListenAddress(options.capabilityListen, "NOWISEE_CAPABILITY_LISTEN")
    : "ephemeral";
  const capServer = await startCapabilityServer({
    listen: capListen,
    tickets: { get: (id) => tickets.get(id) },
    identity,
    accountAppId,
    lockbox,
    oauth,
  });

  async function dispatch(
    kind: "open" | "refresh",
    args: {
      readonly appId: string;
      readonly path?: string;
      readonly nodeId?: string;
      readonly extras: WireExtras;
      readonly token: string | null;
      readonly slot: CookieSlot;
      readonly clientIp?: string;
    },
  ): Promise<RefreshResult> {
    const resolved = await identity.resolve(args.token);
    if (resolved.issuedToken) {
      args.slot.issued = resolved.issuedToken;
    }
    args.slot.clientIp ??= args.clientIp ?? "";

    const app = getApp(db, args.appId);
    if (!app) {
      throw new AppNotFoundError(args.appId);
    }
    const locator = parseLoopbackLocator(app.locator);

    const requestId = randomBytes(32).toString("base64url");
    tickets.set(requestId, {
      appId: app.appId,
      userId: resolved.userId,
      sessionId: resolved.sessionId,
      slot: args.slot,
      grantLockbox: app.grantLockbox,
      grantOauth: app.grantOauth,
    });

    const unsigned: UnsignedWireCtx = {
      userId: resolved.userId,
      sessionId: resolved.sessionId,
      accountAppId,
      requestId,
      exp: Date.now() + WIRE_CTX_TTL_MS,
      ...(app.grantDirectory ? { directory: descriptorsToWire(listDirectory(db)) } : {}),
    };
    const ctx = signWireCtx(app.appId, unsigned, signingPrivate);
    const extras = toRefreshExtras(args.extras);
    const body: Record<string, unknown> = {
      apiVersion: WIRE_API_VERSION,
      ctx,
      extras: args.extras,
    };
    if (kind === "open") {
      body.path = args.path ?? "/";
    } else {
      body.nodeId = args.nodeId ?? "";
    }

    try {
      const result = await postApp(locator, kind, body, app.label, rootAppId, app.appId);
      const after = db.get<{ user_id: string | null }>(
        "SELECT user_id FROM sessions WHERE id = ?",
        resolved.sessionId,
      );
      recordUsage(db, {
        at: Date.now(),
        appId: args.appId,
        sessionId: resolved.sessionId,
        userId: after?.user_id ?? resolved.userId,
        kind: usageKind(kind, extras),
        ip: args.slot.clientIp ?? "",
      });
      return result;
    } finally {
      tickets.delete(requestId);
    }
  }

  return {
    rootAppId,
    accountAppId,
    configuredOrigin: options.configuredOrigin,
    identity,
    oauth,
    db,
    capabilityOrigin: capServer.origin,
    hostSigningPublicKey,
    isAdmin(userId) {
      if (!userId || adminEmails.size === 0) {
        return false;
      }
      const row = db.get<{ email: string }>("SELECT email FROM users WHERE id = ?", userId);
      return Boolean(row && adminEmails.has(row.email));
    },
    open(appId, path, extras) {
      return dispatch("open", { appId, path, extras, token: null, slot: {} });
    },
    refresh(appId, nodeId, extras) {
      return dispatch("refresh", { appId, nodeId, extras, token: null, slot: {} });
    },
    dispatch,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await capServer.close();
      db.close();
    },
  };
}

/** Client-shaped RPC over the broker. Tests prefer `startTestFleet`. */
export function hostRpc(host: NowiseeHost): AppRpc {
  return {
    open(appId, path, extras) {
      return host.open(appId, path, extras);
    },
    refresh(appId, nodeId, extras) {
      return host.refresh(appId, nodeId, extras);
    },
  };
}

async function postApp(
  locator: URL,
  kind: "open" | "refresh",
  body: unknown,
  label: string,
  rootAppId: string,
  appId: string,
): Promise<RefreshResult> {
  const url = new URL(`${locator.origin}${locator.pathname.replace(/\/+$/, "")}/${kind}`);
  try {
    const res = await postJson(url, body);
    if (!res.ok) {
      return notResponding(appId, label, rootAppId);
    }
    return res.json as RefreshResult;
  } catch {
    return notResponding(appId, label, rootAppId);
  }
}

function postJson(url: URL, body: unknown): Promise<{ ok: boolean; json: unknown }> {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.byteLength,
        },
        timeout: DISPATCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = {};
          if (text.length > 0) {
            try {
              json = JSON.parse(text) as unknown;
            } catch {
              json = {};
            }
          }
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, json });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function notResponding(appId: string, label: string, rootAppId: string): RefreshResult {
  const id = `${appId}:host:not-responding`;
  return {
    navigationMap: {
      [id]: {
        back: { kind: "app", to: { appId: rootAppId, path: "/" } },
      },
    },
    warm: [{ id, label: `${label} is not responding.` }],
    node: { id, label: `${label} is not responding.` },
    location: null,
  };
}

export function parseLoopbackLocator(locator: string): URL {
  let url: URL;
  try {
    url = new URL(locator);
  } catch {
    throw new UnsafeLocatorError(locator);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeLocatorError(locator);
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new UnsafeLocatorError(locator);
  }
  return url;
}

export class UnsafeLocatorError extends Error {
  constructor(locator: string) {
    super(`App locator must be loopback HTTP: ${locator}`);
    this.name = "UnsafeLocatorError";
  }
}

function ephemeralLockboxKeyring(): LockboxKeyring {
  return { currentId: "test", keys: { test: EPHEMERAL_LOCKBOX_KEY } };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function resolveDb(db: Db | string | undefined): Db {
  if (db && typeof db === "object") {
    return db;
  }
  return openDatabase({ path: typeof db === "string" ? db : ":memory:" });
}

function toRefreshExtras(extras: WireExtras): RefreshExtras {
  const out: RefreshExtras = {};
  if (extras.inputText !== undefined) {
    out.inputText = extras.inputText;
  }
  if (extras.action) {
    out.action = { triggerId: extras.action.triggerId };
  }
  if (extras.parkedAppIds) {
    out.parkedAppIds = extras.parkedAppIds;
  }
  return out;
}
