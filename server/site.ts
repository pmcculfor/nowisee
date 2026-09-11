import { extname, normalize, resolve, sep } from "node:path";

const ASSET_PREFIX = "/assets"; // host-owned; must stay in Router HOST_PATH_SEGMENTS

const ASSET_MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

export type SiteTarget =
  | { kind: "page" }
  | { kind: "asset"; file: string; type: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "bad-request" };

/**
 * Map a request URL to the one SPA document or a hashed asset under /assets/.
 * Client routes never touch the filesystem. HTML is never served from /assets.
 */
export function siteTarget(url: string, distDir: string): SiteTarget {
  let pathOnly: string;
  try {
    pathOnly = decodeURIComponent((url.split("?")[0] ?? "/").split("#")[0] ?? "/");
  } catch {
    return { kind: "bad-request" };
  }
  if (pathOnly === "" || !pathOnly.startsWith("/")) {
    pathOnly = "/";
  }

  if (pathOnly === ASSET_PREFIX || pathOnly.startsWith(`${ASSET_PREFIX}/`)) {
    return assetTarget(pathOnly, distDir);
  }

  return { kind: "page" };
}

export function pageFile(distDir: string): string {
  return resolve(distDir, "index.html");
}

function assetTarget(pathOnly: string, distDir: string): SiteTarget {
  const relative = pathOnly.replace(/^\/+/, "");
  const assetsRoot = resolve(distDir, "assets");
  const resolved = resolve(distDir, normalize(relative));
  if (!(resolved === assetsRoot || resolved.startsWith(assetsRoot + sep))) {
    return { kind: "forbidden" };
  }
  if (resolved === assetsRoot) {
    return { kind: "not-found" };
  }
  const type = ASSET_MIME[extname(resolved).toLowerCase()];
  if (!type) {
    return { kind: "not-found" };
  }
  return { kind: "asset", file: resolved, type };
}
