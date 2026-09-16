import { normalizeStrongsId } from "./usfmTokens.ts";

export type StrongsEntry = {
  readonly strongs: string;
  readonly lemma: string;
  readonly translit: string;
  readonly body: string;
};

function xmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? "";
}

function child(block: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (match) {
    return match[0];
  }
  const empty = new RegExp(`<${tag}\\b([^>]*)/>`, "i").exec(block);
  return empty?.[0] ?? "";
}

function childInner(block: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match?.[1] ?? "";
}

/** MorphGNT Strong's Greek XML (CC0). */
export function parseStrongsGreekXml(xml: string): StrongsEntry[] {
  const entries: StrongsEntry[] = [];
  const blocks = xml.split(/<entry\b/i).slice(1);
  for (const raw of blocks) {
    const close = raw.indexOf("</entry>");
    const block = close >= 0 ? raw.slice(0, close) : raw;
    const header = block.split(">")[0] ?? "";
    const fromAttr = normalizeStrongsId(`G${attr(`<x ${header}>`, "strongs")}`);
    const fromChild = normalizeStrongsId(`G${xmlText(childInner(block, "strongs"))}`);
    const strongs = fromChild ?? fromAttr;
    if (!strongs?.startsWith("G")) {
      continue;
    }
    const greekTag = /<greek\b[^/]*\/?>/.exec(block)?.[0] ?? "";
    const lemma = attr(greekTag, "unicode");
    const translit = attr(greekTag, "translit") || attr(child(block, "pronunciation"), "strongs");
    const derivation = xmlText(childInner(block, "strongs_derivation"));
    const def = xmlText(childInner(block, "strongs_def"));
    const kjv = xmlText(childInner(block, "kjv_def")).replace(/^:--/, "");
    const body = [derivation, def, kjv].filter(Boolean).join(" ");
    if (!body) {
      continue;
    }
    entries.push({ strongs, lemma, translit, body });
  }
  return entries;
}

/** Open Scriptures HebrewStrong.xml (text PD, XML CC BY 4.0). */
export function parseHebrewStrongXml(xml: string): StrongsEntry[] {
  const entries: StrongsEntry[] = [];
  const blocks = xml.split(/<entry\b/i).slice(1);
  for (const raw of blocks) {
    const close = raw.indexOf("</entry>");
    const block = close >= 0 ? raw.slice(0, close) : raw;
    const header = block.split(">")[0] ?? "";
    const strongs = normalizeStrongsId(attr(`<x ${header}>`, "id"));
    if (!strongs?.startsWith("H")) {
      continue;
    }
    const wTag = /<w\b[^>]*>[\s\S]*?<\/w>/i.exec(block)?.[0] ?? "";
    const lemma = xmlText(wTag);
    const translit = attr(wTag, "pron") || attr(wTag, "xlit");
    const source = xmlText(childInner(block, "source"));
    const meaning = xmlText(childInner(block, "meaning"));
    const usage = xmlText(childInner(block, "usage"));
    const body = [source, meaning, usage].filter(Boolean).join(" ");
    if (!body) {
      continue;
    }
    entries.push({ strongs, lemma, translit, body });
  }
  return entries;
}
