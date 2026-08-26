import { isCanonicalPath } from "./router.ts";
import type { AppLocation, NodePayload, RefreshResult } from "./types.ts";

/**
 * Cheap shape check before Navigator applies a result.
 * Not a third-party schema; missing required fields must not reach apply.
 */
export function isRefreshResult(value: unknown): value is RefreshResult {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNodePayload(value.node)) {
    return false;
  }
  if (!Array.isArray(value.warm) || !value.warm.every(isNodePayload)) {
    return false;
  }
  if (!isRecord(value.navigationMap)) {
    return false;
  }
  if (value.location !== null && !isAppLocation(value.location)) {
    return false;
  }
  if (value.clipboardText !== undefined && typeof value.clipboardText !== "string") {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodePayload(value: unknown): value is NodePayload {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.id !== "string" || typeof value.label !== "string") {
    return false;
  }
  if (value.kind !== undefined && value.kind !== "text" && value.kind !== "input") {
    return false;
  }
  return true;
}

function isAppLocation(value: unknown): value is AppLocation {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.appId === "string" && typeof value.path === "string" && isCanonicalPath(value.path);
}
