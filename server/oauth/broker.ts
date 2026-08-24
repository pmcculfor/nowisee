import type { OAuthConnectionStatus } from "../../src/core/types.ts";
import type { Db } from "../db/index.ts";
import type { LockboxKeyring } from "../lockbox/crypto.ts";
import { assertSlot, LockboxError } from "../lockbox/errors.ts";
import type { LockboxService } from "../lockbox/service.ts";
import { OAuthError } from "./errors.ts";
import {
  registerProviders,
  type NormalizedTokens,
  type OAuthProviderConfig,
  type TokenResponse,
} from "./providers.ts";
import type { OAuthSecrets } from "./secrets.ts";
import {
  decryptPkceVerifier,
  deleteOAuthState,
  findLiveOAuthState,
  getOAuthStateByHash,
  hashOAuthState,
  mintOAuthState,
  mintPkceVerifier,
  pkceChallenge,
  sweepExpiredOAuthStates,
  upsertOAuthState,
} from "./states.ts";

const REFRESH_SKEW_MS = 60_000;

export type OAuthBroker = {
  start(args: {
    readonly userId: string | null;
    readonly sessionId: string;
    readonly appId: string;
    readonly slot: string;
    readonly returnPath?: string;
  }): Promise<{ authorizeUrl: string }>;
  status(args: {
    readonly userId: string | null;
    readonly appId: string;
    readonly slot: string;
  }): Promise<OAuthConnectionStatus>;
  getAccessToken(args: {
    readonly userId: string | null;
    readonly appId: string;
    readonly slot: string;
  }): Promise<string>;
  disconnect(args: {
    readonly userId: string | null;
    readonly appId: string;
    readonly slot: string;
  }): Promise<void>;
  handleCallback(args: {
    readonly sessionId: string;
    readonly userId: string | null;
    readonly state: string | null;
    readonly code: string | null;
    readonly error: string | null;
  }): Promise<{ location: string }>;
  handleProviderEvent(args: {
    readonly appId: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }): Promise<{ status: number; body: string }>;
};

export function createOAuthBroker(args: {
  readonly db: Db;
  readonly lockbox: LockboxService;
  readonly keyring: LockboxKeyring;
  readonly providers: readonly OAuthProviderConfig[];
  readonly secrets: OAuthSecrets;
  readonly configuredOrigin: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}): OAuthBroker {
  const providers = registerProviders(args.providers);
  const doFetch = args.fetch ?? fetch;
  const now = args.now ?? Date.now;
  const refreshLocks = new Map<string, Promise<unknown>>();
  const origin = args.configuredOrigin.replace(/\/+$/, "");

  function requireProvider(appId: string): OAuthProviderConfig {
    const config = providers.get(appId);
    if (!config) {
      throw new OAuthError("not-configured");
    }
    return config;
  }

  function requireSecrets(appId: string) {
    const pair = args.secrets.forApp(appId);
    if (!pair) {
      throw new OAuthError("not-configured");
    }
    return pair;
  }

  function requireSlot(slot: string): void {
    try {
      assertSlot(slot);
    } catch (err) {
      if (err instanceof LockboxError) {
        throw new OAuthError("invalid-slot");
      }
      throw err;
    }
  }

  function redirectUri(): string {
    return `${origin}/oauth/callback`;
  }

  function spaLocation(path: string): string {
    return `${origin}/#${path}`;
  }

  function readTokens(userId: string, appId: string, slot: string): NormalizedTokens | null {
    const bytes = args.lockbox.get(userId, appId, slot);
    if (!bytes) {
      return null;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as NormalizedTokens;
    } catch {
      return { accessToken: "", needsReconnect: true };
    }
  }

  function writeTokens(userId: string, appId: string, slot: string, tokens: NormalizedTokens): void {
    args.lockbox.put(userId, appId, slot, new TextEncoder().encode(JSON.stringify(tokens)));
  }

  async function tokenRequest(appId: string, body: URLSearchParams): Promise<TokenResponse> {
    const config = requireProvider(appId);
    const creds = requireSecrets(appId);
    body.set("client_id", creds.clientId);
    body.set("client_secret", creds.clientSecret);
    if (config.extraTokenParams) {
      for (const [key, value] of Object.entries(config.extraTokenParams)) {
        if (!body.has(key)) {
          body.set(key, value);
        }
      }
    }
    const response = await doFetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    try {
      return (await response.json()) as TokenResponse;
    } catch {
      return { error: "invalid_response" };
    }
  }

  async function normalize(
    appId: string,
    raw: TokenResponse,
    previous?: NormalizedTokens,
  ): Promise<NormalizedTokens> {
    const config = requireProvider(appId);
    if (raw.error || typeof raw.access_token !== "string" || !raw.access_token) {
      if (raw.error === "invalid_grant") {
        throw new OAuthError("needs-reconnect");
      }
      throw new OAuthError("provider-error", String(raw.error_description ?? raw.error ?? "token exchange failed"));
    }
    if (config.finalizeTokens) {
      return config.finalizeTokens(raw);
    }
    const expiresAt =
      typeof raw.expires_in === "number" ? now() + Number(raw.expires_in) * 1000 : previous?.expiresAt;
    return {
      accessToken: raw.access_token,
      refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : previous?.refreshToken,
      expiresAt,
      tokenType: typeof raw.token_type === "string" ? raw.token_type : previous?.tokenType,
      scope: typeof raw.scope === "string" ? raw.scope : previous?.scope,
      extra: previous?.extra,
    };
  }

  async function withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = refreshLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    refreshLocks.set(key, chained);
    await previous.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await fn();
    } finally {
      release();
      if (refreshLocks.get(key) === chained) {
        refreshLocks.delete(key);
      }
    }
  }

  return {
    async start(input) {
      if (!input.userId) {
        throw new OAuthError("not-signed-in");
      }
      requireSlot(input.slot);
      const config = requireProvider(input.appId);
      const creds = requireSecrets(input.appId);
      const returnPath = normalizeReturnPath(input.appId, input.returnPath);
      sweepExpiredOAuthStates(args.db, now());
      const existing = findLiveOAuthState(args.db, input.sessionId, input.appId, input.slot, now());
      if (existing && existing.userId === input.userId) {
        return { authorizeUrl: existing.authorizeUrl };
      }
      const state = mintOAuthState();
      const verifier = mintPkceVerifier();
      const url = new URL(config.authorizationEndpoint);
      url.searchParams.set("client_id", creds.clientId);
      url.searchParams.set("redirect_uri", redirectUri());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", config.scopes.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", pkceChallenge(verifier));
      url.searchParams.set("code_challenge_method", "S256");
      if (config.extraAuthorizeParams) {
        for (const [key, value] of Object.entries(config.extraAuthorizeParams)) {
          url.searchParams.set(key, value);
        }
      }
      const authorizeUrl = url.toString();
      upsertOAuthState(args.db, args.keyring, {
        state,
        sessionId: input.sessionId,
        userId: input.userId,
        appId: input.appId,
        slot: input.slot,
        verifier,
        authorizeUrl,
        returnPath,
        now: now(),
      });
      return { authorizeUrl };
    },

    async status(input) {
      if (!input.userId) {
        throw new OAuthError("not-signed-in");
      }
      requireSlot(input.slot);
      const tokens = readTokens(input.userId, input.appId, input.slot);
      if (!tokens) {
        return "missing";
      }
      if (tokens.needsReconnect || (!tokens.accessToken && !tokens.refreshToken)) {
        return "needs-reconnect";
      }
      return "ready";
    },

    async getAccessToken(input) {
      if (!input.userId) {
        throw new OAuthError("not-signed-in");
      }
      requireSlot(input.slot);
      const key = `${input.userId}:${input.appId}:${input.slot}`;
      return withRefreshLock(key, async () => {
        const tokens = readTokens(input.userId!, input.appId, input.slot);
        if (!tokens) {
          throw new OAuthError("missing");
        }
        if (tokens.needsReconnect) {
          throw new OAuthError("needs-reconnect");
        }
        if (
          tokens.accessToken &&
          (tokens.expiresAt === undefined || tokens.expiresAt > now() + REFRESH_SKEW_MS)
        ) {
          return tokens.accessToken;
        }
        if (!tokens.refreshToken) {
          throw new OAuthError("needs-reconnect");
        }
        const config = requireProvider(input.appId);
        try {
          const next = config.refreshTokens
            ? await config.refreshTokens(tokens)
            : await normalize(
                input.appId,
                await tokenRequest(
                  input.appId,
                  new URLSearchParams({
                    grant_type: "refresh_token",
                    refresh_token: tokens.refreshToken,
                  }),
                ),
                tokens,
              );
          writeTokens(input.userId!, input.appId, input.slot, next);
          return next.accessToken;
        } catch (err) {
          if (err instanceof OAuthError && err.code === "needs-reconnect") {
            args.lockbox.delete(input.userId!, input.appId, input.slot);
          }
          throw err;
        }
      });
    },

    async disconnect(input) {
      if (!input.userId) {
        throw new OAuthError("not-signed-in");
      }
      requireSlot(input.slot);
      const tokens = readTokens(input.userId, input.appId, input.slot);
      const config = requireProvider(input.appId);
      const creds = requireSecrets(input.appId);
      if (tokens && config.revokeEndpoint) {
        const token = tokens.refreshToken ?? tokens.accessToken;
        if (token) {
          try {
            await doFetch(config.revokeEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token,
                token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token",
                client_id: creds.clientId,
                client_secret: creds.clientSecret,
              }),
            });
          } catch {
            // best-effort
          }
        }
      }
      args.lockbox.delete(input.userId, input.appId, input.slot);
    },

    async handleCallback(input) {
      sweepExpiredOAuthStates(args.db, now());
      if (!input.state) {
        return { location: spaLocation("/") };
      }
      const row = getOAuthStateByHash(args.db, hashOAuthState(input.state), now());
      if (!row) {
        return { location: spaLocation("/") };
      }
      deleteOAuthState(args.db, row.stateHash);
      if (input.error) {
        return { location: spaLocation(`/${row.appId}`) };
      }
      if (row.sessionId !== input.sessionId || !input.userId || row.userId !== input.userId) {
        return { location: spaLocation("/") };
      }
      if (!input.code) {
        return { location: spaLocation(`/${row.appId}`) };
      }
      const verifier = decryptPkceVerifier(args.keyring, row);
      try {
        const tokens = await normalize(
          row.appId,
          await tokenRequest(
            row.appId,
            new URLSearchParams({
              grant_type: "authorization_code",
              code: input.code,
              redirect_uri: redirectUri(),
              code_verifier: verifier,
            }),
          ),
        );
        writeTokens(row.userId, row.appId, row.slot, tokens);
        return { location: spaLocation(row.returnPath) };
      } catch {
        return { location: spaLocation(`/${row.appId}`) };
      }
    },

    async handleProviderEvent(input) {
      const config = providers.get(input.appId);
      if (!config?.onProviderEvent) {
        return { status: 404, body: "" };
      }
      const result = await config.onProviderEvent({ headers: input.headers, body: input.body });
      return { status: result.status, body: result.body ?? "" };
    },
  };
}

export function normalizeReturnPath(appId: string, returnPath: string | undefined): string {
  const fallback = `/${appId}`;
  if (!returnPath || returnPath === "/") {
    return fallback;
  }
  let path = returnPath;
  if (!path.startsWith(`/${appId}`)) {
    if (path.startsWith("/") && !path.startsWith("//")) {
      path = `/${appId}${path}`;
    } else {
      throw new OAuthError("invalid-return-path");
    }
  }
  if (
    path.includes("//") ||
    path.includes("..") ||
    path.includes(":") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\")
  ) {
    throw new OAuthError("invalid-return-path");
  }
  if (path !== fallback && !path.startsWith(`${fallback}/`)) {
    throw new OAuthError("invalid-return-path");
  }
  return path;
}
