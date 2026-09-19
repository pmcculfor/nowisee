import type {
  AuthOutcome,
  IdentityCapability,
  LockboxCapability,
  OAuthCapability,
  OAuthConnectionStatus,
  RequestSignInOutcome,
} from "../core/types.ts";

export class CapabilityError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "CapabilityError";
    this.code = code;
    this.status = status;
  }
}

export function createLockboxClient(capabilityUrl: string, requestId: string): LockboxCapability {
  return {
    async get(slot) {
      const body = await capPost<{ plaintext: string | null }>(capabilityUrl, requestId, "/lockbox/get", {
        slot,
      });
      if (body.plaintext === null) {
        return null;
      }
      return Uint8Array.from(Buffer.from(body.plaintext, "base64"));
    },
    async put(slot, plaintext) {
      await capPost(capabilityUrl, requestId, "/lockbox/put", {
        slot,
        plaintext: Buffer.from(plaintext).toString("base64"),
      });
    },
    async delete(slot) {
      await capPost(capabilityUrl, requestId, "/lockbox/delete", { slot });
    },
  };
}

export function createOAuthClient(capabilityUrl: string, requestId: string): OAuthCapability {
  return {
    start(opts) {
      return capPost(capabilityUrl, requestId, "/oauth/start", opts);
    },
    status(slot) {
      return capPost<OAuthConnectionStatus>(capabilityUrl, requestId, "/oauth/status", { slot });
    },
    getAccessToken(slot) {
      return capPost<{ accessToken: string }>(capabilityUrl, requestId, "/oauth/getAccessToken", {
        slot,
      }).then((body) => body.accessToken);
    },
    disconnect(slot) {
      return capPost(capabilityUrl, requestId, "/oauth/disconnect", { slot }).then(() => undefined);
    },
  };
}

export function createIdentityClient(capabilityUrl: string, requestId: string): IdentityCapability {
  return {
    requestSignIn(email) {
      return capPost<RequestSignInOutcome>(capabilityUrl, requestId, "/identity/requestSignIn", {
        email,
      });
    },
    verifySignIn(code) {
      return capPost<AuthOutcome>(capabilityUrl, requestId, "/identity/verifySignIn", { code });
    },
    signOut() {
      return capPost(capabilityUrl, requestId, "/identity/signOut", {}).then(() => undefined);
    },
  };
}

async function capPost<T>(
  capabilityUrl: string,
  requestId: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(joinUrl(capabilityUrl, path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requestId}`,
    },
    body: JSON.stringify(body),
  });
  const parsed = await readJson(res);
  if (!res.ok) {
    const code = errorCode(parsed, res.status);
    throw new CapabilityError(res.status, code);
  }
  return parsed as T;
}

function joinUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: "invalid-json" };
  }
}

function errorCode(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "code" in body) {
    const code = (body as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 401) {
    return "unauthorized";
  }
  return "capability-failed";
}
