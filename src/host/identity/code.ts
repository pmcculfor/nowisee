import { randomInt } from "node:crypto";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000;
export const SIGN_IN_CODE_MAX_ATTEMPTS = 5;

export function generateSignInCode(): string {
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += LETTERS[randomInt(LETTERS.length)];
  }
  for (let i = 0; i < 3; i++) {
    out += String(randomInt(10));
  }
  return out;
}

/** Strip spaces/punctuation, lowercase; require three letters then three digits. */
export function normalizeSignInCode(raw: string): string | null {
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!/^[a-z]{3}[0-9]{3}$/.test(compact)) {
    return null;
  }
  return compact;
}

export function signInCodeEmailText(code: string): string {
  const spoken = code.split("").join(" ");
  return `Your Now I See sign-in code is ${spoken}\n(that is ${code}). It expires in 10 minutes.\n`;
}

export function extractSignInCodeFromEmailText(text: string): string | null {
  const match = /that is ([a-z]{3}[0-9]{3})/.exec(text);
  return match?.[1] ?? null;
}
