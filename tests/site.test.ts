import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appleAppSiteAssociation,
  appleTeamId,
  IOS_BUNDLE_ID,
  pageFile,
  siteTarget,
} from "../src/host/site.ts";

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

  it("does not serve the SPA for apple-app-site-association", () => {
    expect(siteTarget("/.well-known/apple-app-site-association", DIST)).toEqual({
      kind: "association",
    });
    expect(siteTarget("/apple-app-site-association", DIST)).toEqual({ kind: "association" });
    expect(siteTarget("/.well-known/apple-app-site-association?foo=1", DIST)).toEqual({
      kind: "association",
    });
  });
});

describe("apple-app-site-association", () => {
  it("accepts a ten-character team id", () => {
    expect(appleTeamId("abcd123456")).toBe("ABCD123456");
    expect(appleTeamId(" ABCD123456 ")).toBe("ABCD123456");
    expect(appleTeamId("short")).toBeNull();
    expect(appleTeamId("")).toBeNull();
    expect(appleTeamId(undefined)).toBeNull();
  });

  it("names the iPhone client for applinks and webcredentials", () => {
    const parsed = JSON.parse(appleAppSiteAssociation("ABCD123456")) as {
      applinks: { details: { appID: string; paths: string[] }[] };
      webcredentials: { apps: string[] };
    };
    const appId = `ABCD123456.${IOS_BUNDLE_ID}`;
    expect(parsed.applinks.details[0]?.appID).toBe(appId);
    expect(parsed.applinks.details[0]?.paths).toEqual(["/oauth/callback"]);
    expect(parsed.webcredentials.apps).toEqual([appId]);
  });
});
