import type { AppDescriptor, HomeRole } from "../src/core/types.ts";
import type { Db } from "./db/index.ts";
import {
  assertSafeEndpoint,
  type OAuthProviderConfig,
} from "./oauth/providers.ts";

export type CatalogApp = {
  readonly appId: string;
  readonly locator: string;
  readonly label: string;
  readonly grantLockbox: boolean;
  readonly grantOauth: boolean;
  readonly grantDirectory: boolean;
  readonly oauthProvider: OAuthProviderConfig | undefined;
  readonly homeRole: HomeRole | undefined;
  readonly parkable: boolean | undefined;
  readonly sortOrder: number;
};

type CatalogRow = {
  app_id: string;
  locator: string;
  grant_lockbox: number;
  grant_oauth: number;
  grant_directory: number;
  label: string;
  oauth_provider: string | null;
  home_role: string | null;
  parkable: number | null;
  sort_order: number;
};

const SELECT_ENABLED = `SELECT app_id, locator, grant_lockbox, grant_oauth, grant_directory,
  label, oauth_provider, home_role, parkable, sort_order
  FROM app_catalog WHERE enabled = 1`;

/** Missing or disabled → `undefined`. */
export function getApp(db: Db, appId: string): CatalogApp | undefined {
  const row = db.get<CatalogRow>(`${SELECT_ENABLED} AND app_id = ?`, appId);
  return row ? fromRow(row) : undefined;
}

export function listDirectory(db: Db): readonly AppDescriptor[] {
  const rows = db.all<CatalogRow>(`${SELECT_ENABLED} ORDER BY sort_order ASC, app_id ASC`);
  return rows.map((row) => toDescriptor(fromRow(row)));
}

export function setLocator(db: Db, appId: string, locator: string): void {
  db.run("UPDATE app_catalog SET locator = ? WHERE app_id = ?", locator, appId);
}

export function setEnabled(db: Db, appId: string, enabled: boolean): void {
  db.run("UPDATE app_catalog SET enabled = ? WHERE app_id = ?", enabled ? 1 : 0, appId);
}

export function setGrant(
  db: Db,
  appId: string,
  grant: "grant_lockbox" | "grant_oauth" | "grant_directory",
  value: boolean,
): void {
  db.run(`UPDATE app_catalog SET ${grant} = ? WHERE app_id = ?`, value ? 1 : 0, appId);
}

export type CatalogUpsert = {
  readonly appId: string;
  readonly locator: string;
  readonly label: string;
  readonly enabled?: boolean;
  readonly grantLockbox?: boolean;
  readonly grantOauth?: boolean;
  readonly grantDirectory?: boolean;
  readonly oauthProvider?: OAuthProviderConfig | null;
  readonly homeRole?: HomeRole | null;
  readonly parkable?: boolean | null;
  readonly sortOrder?: number;
};

export function upsertApp(db: Db, row: CatalogUpsert): void {
  db.run(
    `INSERT INTO app_catalog (
       app_id, locator, enabled, grant_lockbox, grant_oauth, grant_directory,
       label, oauth_provider, home_role, parkable, sort_order
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(app_id) DO UPDATE SET
       locator = excluded.locator,
       enabled = excluded.enabled,
       grant_lockbox = excluded.grant_lockbox,
       grant_oauth = excluded.grant_oauth,
       grant_directory = excluded.grant_directory,
       label = excluded.label,
       oauth_provider = excluded.oauth_provider,
       home_role = excluded.home_role,
       parkable = excluded.parkable,
       sort_order = excluded.sort_order`,
    row.appId,
    row.locator,
    row.enabled === false ? 0 : 1,
    row.grantLockbox ? 1 : 0,
    row.grantOauth ? 1 : 0,
    row.grantDirectory ? 1 : 0,
    row.label,
    row.oauthProvider ? JSON.stringify(serializeProvider(row.oauthProvider)) : null,
    row.homeRole ?? null,
    row.parkable === undefined || row.parkable === null ? null : row.parkable ? 1 : 0,
    row.sortOrder ?? 0,
  );
}

export function parseOAuthProviderJson(raw: string): OAuthProviderConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("oauth_provider must be JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("oauth_provider must be an object");
  }
  const rec = parsed as Record<string, unknown>;
  const appId = requireString(rec.appId, "oauth_provider.appId");
  const authorizationEndpoint = requireString(
    rec.authorizationEndpoint,
    "oauth_provider.authorizationEndpoint",
  );
  const tokenEndpoint = requireString(rec.tokenEndpoint, "oauth_provider.tokenEndpoint");
  const revokeEndpoint =
    rec.revokeEndpoint === undefined || rec.revokeEndpoint === null
      ? undefined
      : requireString(rec.revokeEndpoint, "oauth_provider.revokeEndpoint");
  if (!Array.isArray(rec.scopes) || !rec.scopes.every((s) => typeof s === "string")) {
    throw new Error("oauth_provider.scopes must be an array of strings");
  }
  assertSafeEndpoint(authorizationEndpoint);
  assertSafeEndpoint(tokenEndpoint);
  if (revokeEndpoint) {
    assertSafeEndpoint(revokeEndpoint);
  }
  const config: {
    appId: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revokeEndpoint?: string;
    scopes: readonly string[];
    extraAuthorizeParams?: Readonly<Record<string, string>>;
    extraTokenParams?: Readonly<Record<string, string>>;
  } = {
    appId,
    authorizationEndpoint,
    tokenEndpoint,
    scopes: rec.scopes as readonly string[],
  };
  if (revokeEndpoint) {
    config.revokeEndpoint = revokeEndpoint;
  }
  if (rec.extraAuthorizeParams !== undefined) {
    config.extraAuthorizeParams = requireStringMap(
      rec.extraAuthorizeParams,
      "oauth_provider.extraAuthorizeParams",
    );
  }
  if (rec.extraTokenParams !== undefined) {
    config.extraTokenParams = requireStringMap(rec.extraTokenParams, "oauth_provider.extraTokenParams");
  }
  return config;
}

function serializeProvider(config: OAuthProviderConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    appId: config.appId,
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    scopes: config.scopes,
  };
  if (config.revokeEndpoint) {
    out.revokeEndpoint = config.revokeEndpoint;
  }
  if (config.extraAuthorizeParams) {
    out.extraAuthorizeParams = config.extraAuthorizeParams;
  }
  if (config.extraTokenParams) {
    out.extraTokenParams = config.extraTokenParams;
  }
  return out;
}

function fromRow(row: CatalogRow): CatalogApp {
  return {
    appId: row.app_id,
    locator: row.locator,
    label: row.label,
    grantLockbox: row.grant_lockbox === 1,
    grantOauth: row.grant_oauth === 1,
    grantDirectory: row.grant_directory === 1,
    oauthProvider: row.oauth_provider ? parseOAuthProviderJson(row.oauth_provider) : undefined,
    homeRole: parseHomeRole(row.home_role),
    parkable: row.parkable === null ? undefined : row.parkable === 1,
    sortOrder: row.sort_order,
  };
}

function toDescriptor(app: CatalogApp): AppDescriptor {
  const d: { id: string; label: string; homeRole?: HomeRole; parkable?: boolean } = {
    id: app.appId,
    label: app.label,
  };
  if (app.homeRole) {
    d.homeRole = app.homeRole;
  }
  if (app.parkable === false) {
    d.parkable = false;
  }
  return d;
}

function parseHomeRole(value: string | null): HomeRole | undefined {
  if (value === "internal" || value === "required" || value === "default" || value === "optional") {
    return value;
  }
  if (value === null) {
    return undefined;
  }
  throw new Error(`Unknown home_role "${value}"`);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireStringMap(value: unknown, name: string): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== "string") {
      throw new Error(`${name}.${key} must be a string`);
    }
    out[key] = item;
  }
  return out;
}
