import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { AppDescriptor, HomeRole } from "../core/types.ts";

export const WIRE_API_VERSION = 1;
export const WIRE_CTX_TTL_MS = 60_000;

export type WireDirectoryEntry = {
  readonly id: string;
  readonly label: string;
  readonly homeRole?: HomeRole;
  readonly parkable?: boolean;
};

export type UnsignedWireCtx = {
  readonly userId: string | null;
  readonly sessionId: string;
  readonly accountAppId: string;
  readonly directory?: readonly WireDirectoryEntry[];
  readonly requestId: string;
  readonly exp: number;
};

export type WireCtx = UnsignedWireCtx & {
  readonly sig: string;
};

export type WireAppBody = {
  readonly apiVersion: number;
  readonly ctx: WireCtx;
  readonly extras: unknown;
  readonly path?: string;
  readonly nodeId?: string;
};

export type HostSigningKeyPair = {
  readonly privateKey: string;
  readonly publicKey: string;
};

export function generateHostSigningKeyPair(): HostSigningKeyPair {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export function publicKeyFromPrivate(privateKeyB64: string): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");
}

export function descriptorsToWire(
  descriptors: readonly AppDescriptor[],
): readonly WireDirectoryEntry[] {
  return descriptors.map((d) => {
    const entry: {
      id: string;
      label: string;
      homeRole?: HomeRole;
      parkable?: boolean;
    } = { id: d.id, label: d.label };
    if (d.homeRole) {
      entry.homeRole = d.homeRole;
    }
    if (d.parkable === false) {
      entry.parkable = false;
    }
    return entry;
  });
}

export function signWireCtx(appId: string, ctx: UnsignedWireCtx, privateKeyB64: string): WireCtx {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const sig = sign(null, canonicalBytes(appId, ctx), privateKey).toString("base64");
  return { ...ctx, sig };
}

export function verifyWireCtx(appId: string, ctx: WireCtx, publicKeyB64: string, now = Date.now()): void {
  if (now > ctx.exp) {
    throw new WireCtxError("expired");
  }
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyB64, "base64"),
    format: "der",
    type: "spki",
  });
  const { sig, ...unsigned } = ctx;
  const ok = verify(null, canonicalBytes(appId, unsigned), publicKey, Buffer.from(sig, "base64"));
  if (!ok) {
    throw new WireCtxError("invalid-signature");
  }
}

export class WireCtxError extends Error {
  readonly code: "expired" | "invalid-signature";
  constructor(code: "expired" | "invalid-signature") {
    super(code);
    this.name = "WireCtxError";
    this.code = code;
  }
}

function canonicalBytes(appId: string, ctx: UnsignedWireCtx): Buffer {
  return Buffer.from(
    JSON.stringify({
      apiVersion: WIRE_API_VERSION,
      appId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      accountAppId: ctx.accountAppId,
      directory: ctx.directory ?? null,
      requestId: ctx.requestId,
      exp: ctx.exp,
    }),
  );
}
