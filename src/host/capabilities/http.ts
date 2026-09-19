import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppHttpResponse } from "../http.ts";
import type { CookieSlot } from "../identity/context.ts";
import { bindIdentity } from "../identity/context.ts";
import type { IdentityService } from "../identity/service.ts";
import { bindLockbox } from "../lockbox/capability.ts";
import { LockboxError } from "../lockbox/errors.ts";
import type { LockboxService } from "../lockbox/service.ts";
import { listenHttp, type ListeningServer } from "../../node-kit/listenHttp.ts";
import { bindOAuth } from "../oauth/capability.ts";
import { OAuthError } from "../oauth/errors.ts";
import type { OAuthBroker } from "../oauth/broker.ts";
import { BodyTooLargeError, MalformedJsonError, readJsonBody } from "../../node-kit/readBody.ts";

export type CapabilityTicket = {
  readonly appId: string;
  readonly userId: string | null;
  readonly sessionId: string;
  readonly slot: CookieSlot;
  readonly grantLockbox: boolean;
  readonly grantOauth: boolean;
};

export type CapabilityTickets = {
  get(requestId: string): CapabilityTicket | undefined;
};

export type CapabilityServerOptions = {
  readonly listen: { host: string; port: number } | "ephemeral";
  readonly tickets: CapabilityTickets;
  readonly identity: IdentityService;
  readonly accountAppId: string;
  readonly lockbox?: LockboxService;
  readonly oauth?: OAuthBroker;
};

export async function startCapabilityServer(
  options: CapabilityServerOptions,
): Promise<ListeningServer> {
  return listenHttp((req, res) => handleCapabilityHttp(options, req, res), options.listen);
}

async function handleCapabilityHttp(
  options: CapabilityServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const out = await route(options, req);
  const json = JSON.stringify(out.body ?? {});
  res.statusCode = out.status;
  for (const [key, value] of Object.entries(out.headers ?? {})) {
    res.setHeader(key, value);
  }
  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}

async function route(
  options: CapabilityServerOptions,
  req: IncomingMessage,
): Promise<AppHttpResponse> {
  if (req.method !== "POST") {
    return fail(405, "method-not-allowed");
  }
  const path = (req.url?.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return fail(413, "too-large");
    }
    if (err instanceof MalformedJsonError) {
      return fail(400, "invalid-json");
    }
    throw err;
  }

  const requestId = bearerToken(req.headers.authorization);
  if (!requestId) {
    return fail(401, "unauthorized");
  }
  const ticket = options.tickets.get(requestId);
  if (!ticket) {
    return fail(401, "unauthorized");
  }

  try {
    const result = await dispatch(options, ticket, path, body ?? {});
    return { status: 200, body: result, headers: { "Cache-Control": "no-store" } };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return fail(403, "forbidden");
    }
    if (err instanceof CapabilityNotFoundError) {
      return fail(404, "not-found");
    }
    if (err instanceof LockboxError) {
      return fail(400, err.code);
    }
    if (err instanceof OAuthError) {
      return fail(400, err.code);
    }
    throw err;
  }
}

async function dispatch(
  options: CapabilityServerOptions,
  ticket: CapabilityTicket,
  path: string,
  body: unknown,
): Promise<unknown> {
  switch (path) {
    case "/lockbox/get": {
      requireGrant(ticket.grantLockbox);
      const slot = field(body, "slot");
      const plaintext = await lockboxOf(options, ticket).get(slot);
      return { plaintext: plaintext ? Buffer.from(plaintext).toString("base64") : null };
    }
    case "/lockbox/put": {
      requireGrant(ticket.grantLockbox);
      const slot = field(body, "slot");
      const plaintext = bytesField(body, "plaintext");
      await lockboxOf(options, ticket).put(slot, plaintext);
      return {};
    }
    case "/lockbox/delete": {
      requireGrant(ticket.grantLockbox);
      await lockboxOf(options, ticket).delete(field(body, "slot"));
      return {};
    }
    case "/oauth/start": {
      requireGrant(ticket.grantOauth);
      const rec = asObject(body);
      const slot = requireString(rec.slot, "slot");
      const returnPath =
        rec.returnPath === undefined ? undefined : requireString(rec.returnPath, "returnPath");
      return oauthOf(options, ticket).start({ slot, returnPath });
    }
    case "/oauth/status": {
      requireGrant(ticket.grantOauth);
      return oauthOf(options, ticket).status(field(body, "slot"));
    }
    case "/oauth/getAccessToken": {
      requireGrant(ticket.grantOauth);
      const accessToken = await oauthOf(options, ticket).getAccessToken(field(body, "slot"));
      return { accessToken };
    }
    case "/oauth/disconnect": {
      requireGrant(ticket.grantOauth);
      await oauthOf(options, ticket).disconnect(field(body, "slot"));
      return {};
    }
    case "/identity/requestSignIn": {
      requireIdentity(options, ticket);
      return bindIdentity(options.identity, ticket.sessionId, ticket.slot).requestSignIn(
        field(body, "email"),
      );
    }
    case "/identity/verifySignIn": {
      requireIdentity(options, ticket);
      return bindIdentity(options.identity, ticket.sessionId, ticket.slot).verifySignIn(
        field(body, "code"),
      );
    }
    case "/identity/signOut": {
      requireIdentity(options, ticket);
      await bindIdentity(options.identity, ticket.sessionId, ticket.slot).signOut();
      return {};
    }
    default:
      throw new CapabilityNotFoundError();
  }
}

class ForbiddenError extends Error {}
class CapabilityNotFoundError extends Error {}

function requireGrant(granted: boolean): void {
  if (!granted) {
    throw new ForbiddenError();
  }
}

function requireIdentity(options: CapabilityServerOptions, ticket: CapabilityTicket): void {
  if (ticket.appId !== options.accountAppId) {
    throw new ForbiddenError();
  }
}

function lockboxOf(options: CapabilityServerOptions, ticket: CapabilityTicket) {
  if (!options.lockbox) {
    throw new ForbiddenError();
  }
  return bindLockbox(options.lockbox, ticket.userId, ticket.appId);
}

function oauthOf(options: CapabilityServerOptions, ticket: CapabilityTicket) {
  if (!options.oauth) {
    throw new ForbiddenError();
  }
  return bindOAuth(options.oauth, {
    userId: ticket.userId,
    sessionId: ticket.sessionId,
    appId: ticket.appId,
  });
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match?.[1];
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new LockboxError("invalid-slot");
  }
  return body as Record<string, unknown>;
}

function field(body: unknown, name: string): string {
  return requireString(asObject(body)[name], name);
}

function bytesField(body: unknown, name: string): Uint8Array {
  const raw = requireString(asObject(body)[name], name);
  return Uint8Array.from(Buffer.from(raw, "base64"));
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function fail(status: number, code: string): AppHttpResponse {
  return {
    status,
    body: { error: code, code },
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  };
}
