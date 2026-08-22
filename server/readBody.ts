import type { IncomingMessage } from "node:http";

export const MAX_API_BODY_BYTES = 1_048_576;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
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
