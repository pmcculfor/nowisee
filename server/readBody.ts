import type { IncomingMessage } from "node:http";

export const MAX_API_BODY_BYTES = 1_048_576;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
  }
}

/** The client sent something that is not JSON. Distinct from a handler throwing. */
export class MalformedJsonError extends Error {
  constructor() {
    super("Invalid JSON");
  }
}

/** Read a POST body and parse it. `undefined` when there is no body to parse. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = req.method === "POST" ? await readLimitedBody(req) : "";
  if (raw.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new MalformedJsonError();
  }
}

export async function readLimitedBody(
  req: IncomingMessage,
  maxBytes: number = MAX_API_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.byteLength;
    if (total > maxBytes) {
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
