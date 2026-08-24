/**
 * Gmail API payload helpers. Prefer text/plain in multipart/alternative.
 * HTML-only: a conservative tag strip — not a browser.
 */

export type GmailPayloadPart = {
  readonly mimeType?: string;
  readonly filename?: string;
  readonly body?: { readonly data?: string; readonly size?: number };
  readonly parts?: readonly GmailPayloadPart[];
};

export function extractPlainText(payload: GmailPayloadPart | undefined): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    return decodeBase64Url(plain.body.data);
  }
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    return stripHtml(decodeBase64Url(html.body.data));
  }
  if (payload?.body?.data && (!payload.parts || payload.parts.length === 0)) {
    const raw = decodeBase64Url(payload.body.data);
    if ((payload.mimeType ?? "").toLowerCase().startsWith("text/html")) {
      return stripHtml(raw);
    }
    return raw;
  }
  return "";
}

export function encodeRawMessage(args: {
  readonly from?: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}): string {
  const lines: string[] = [];
  if (args.from) {
    lines.push(`From: ${headerValue(args.from)}`);
  }
  lines.push(
    `To: ${headerValue(args.to)}`,
    `Subject: ${encodeSubject(args.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    args.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
  );
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(padded, "base64");
  return buf.toString("utf8");
}

function encodeSubject(subject: string): string {
  const value = headerValue(subject);
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function findPart(
  part: GmailPayloadPart | undefined,
  mime: string,
): GmailPayloadPart | undefined {
  if (!part) {
    return undefined;
  }
  const type = (part.mimeType ?? "").toLowerCase();
  if (type.split(";")[0]?.trim() === mime && part.body?.data) {
    return part;
  }
  if (!part.parts) {
    return undefined;
  }
  for (const child of part.parts) {
    const found = findPart(child, mime);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
