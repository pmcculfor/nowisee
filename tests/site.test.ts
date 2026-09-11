import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pageFile, siteTarget } from "../server/site.ts";

const DIST = resolve("/tmp/nowisee-dist");

describe("siteTarget", () => {
  it("serves the one HTML document for client routes", () => {
    expect(siteTarget("/", DIST)).toEqual({ kind: "page" });
    expect(siteTarget("/bible/Matthew/5/8", DIST)).toEqual({ kind: "page" });
    expect(siteTarget("/home", DIST)).toEqual({ kind: "page" });
    expect(pageFile(DIST)).toBe(resolve(DIST, "index.html"));
  });

  it("maps hashed assets under /assets/", () => {
    expect(siteTarget("/assets/index-abc.js", DIST)).toEqual({
      kind: "asset",
      file: resolve(DIST, "assets/index-abc.js"),
      type: "text/javascript; charset=utf-8",
    });
    expect(siteTarget("/assets", DIST)).toEqual({ kind: "not-found" });
    expect(siteTarget("/assets/", DIST)).toEqual({ kind: "not-found" });
    expect(siteTarget("/assets/page.html", DIST)).toEqual({ kind: "not-found" });
    expect(siteTarget("/assets/secret.bin", DIST)).toEqual({ kind: "not-found" });
  });

  it("rejects traversal out of /assets/", () => {
    expect(siteTarget("/assets/../index.html", DIST)).toEqual({ kind: "forbidden" });
    expect(siteTarget("/assets/%2e%2e/index.html", DIST)).toEqual({ kind: "forbidden" });
  });

  it("rejects a broken percent sequence", () => {
    expect(siteTarget("/%zz", DIST)).toEqual({ kind: "bad-request" });
  });
});
