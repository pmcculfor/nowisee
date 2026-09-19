import type { Db, SqlValue } from "../db/index.ts";
import { HOUR_MS, hourBucket } from "../usage.ts";

export type RangeId = "24h" | "7d" | "30d" | "all";

export function parseRange(value: unknown): RangeId {
  if (value === "24h" || value === "7d" || value === "30d" || value === "all") {
    return value;
  }
  return "7d";
}

export function rangeStartMs(range: RangeId, now: number): number | null {
  if (range === "all") {
    return null;
  }
  if (range === "24h") {
    return now - 24 * HOUR_MS;
  }
  if (range === "7d") {
    return now - 7 * 24 * HOUR_MS;
  }
  return now - 30 * 24 * HOUR_MS;
}

export function rangeStartHour(range: RangeId, now: number): number | null {
  const ms = rangeStartMs(range, now);
  return ms === null ? null : hourBucket(ms);
}

type Counts = { opens: number; refreshes: number; actions: number };

function asCount(value: number | bigint | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

function since(sql: string, from: number | null, column: string): { sql: string; params: SqlValue[] } {
  if (from === null) {
    return { sql, params: [] };
  }
  const glue = /\bWHERE\b/i.test(sql) ? " AND " : " WHERE ";
  return { sql: `${sql}${glue}${column} >= ?`, params: [from] };
}

export function adminSummary(db: Db, now: number, range: RangeId) {
  const fromMs = rangeStartMs(range, now);
  const fromHour = rangeStartHour(range, now);
  const usersTotal = asCount(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n);
  const usersNewQ = since("SELECT COUNT(*) AS n FROM users", fromMs, "created_at");
  const usersNew = asCount(db.get<{ n: number }>(usersNewQ.sql, ...usersNewQ.params)?.n);
  const loginsQ = since("SELECT COUNT(*) AS n FROM login_events", fromMs, "at");
  const logins = asCount(db.get<{ n: number }>(loginsQ.sql, ...loginsQ.params)?.n);
  const loginKindsQ = since(
    "SELECT kind, COUNT(*) AS n FROM login_events",
    fromMs,
    "at",
  );
  const loginKinds = db.all<{ kind: string; n: number }>(
    `${loginKindsQ.sql} GROUP BY kind`,
    ...loginKindsQ.params,
  );
  let loginsRegister = 0;
  let loginsSignIn = 0;
  for (const row of loginKinds) {
    if (row.kind === "register") {
      loginsRegister = asCount(row.n);
    } else if (row.kind === "sign_in") {
      loginsSignIn = asCount(row.n);
    }
  }
  const liveSessions = asCount(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sessions
       WHERE user_id IS NOT NULL AND expires_at > ? AND idle_expires_at > ?`,
      now,
      now,
    )?.n,
  );
  const usageQ = since(
    "SELECT COALESCE(SUM(opens), 0) AS opens, COALESCE(SUM(refreshes), 0) AS refreshes, COALESCE(SUM(actions), 0) AS actions, COALESCE(SUM(CASE WHEN user_id IS NULL THEN opens + refreshes + actions ELSE 0 END), 0) AS anonymous_calls, COALESCE(SUM(CASE WHEN user_id IS NOT NULL THEN opens + refreshes + actions ELSE 0 END), 0) AS signed_in_calls, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT user_id) AS users FROM usage_hourly",
    fromHour,
    "hour",
  );
  const usage = db.get<{
    opens: number;
    refreshes: number;
    actions: number;
    anonymous_calls: number;
    signed_in_calls: number;
    sessions: number;
    users: number;
  }>(usageQ.sql, ...usageQ.params);
  const byAppQ = since(
    "SELECT app_id, COALESCE(SUM(opens), 0) AS opens, COALESCE(SUM(refreshes), 0) AS refreshes, COALESCE(SUM(actions), 0) AS actions, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT user_id) AS users FROM usage_hourly",
    fromHour,
    "hour",
  );
  const byApp = db.all<{
    app_id: string;
    opens: number;
    refreshes: number;
    actions: number;
    sessions: number;
    users: number;
  }>(`${byAppQ.sql} GROUP BY app_id ORDER BY app_id`, ...byAppQ.params);
  return {
    range,
    usersTotal,
    usersNew,
    logins,
    loginsRegister,
    loginsSignIn,
    liveSessions,
    opens: asCount(usage?.opens),
    refreshes: asCount(usage?.refreshes),
    actions: asCount(usage?.actions),
    anonymousCalls: asCount(usage?.anonymous_calls),
    signedInCalls: asCount(usage?.signed_in_calls),
    uniqueSessions: asCount(usage?.sessions),
    uniqueUsers: asCount(usage?.users),
    byApp: byApp.map((row) => ({
      appId: row.app_id,
      opens: asCount(row.opens),
      refreshes: asCount(row.refreshes),
      actions: asCount(row.actions),
      sessions: asCount(row.sessions),
      users: asCount(row.users),
    })),
  };
}

export function adminUsers(db: Db, now: number, range: RangeId, q: string) {
  const fromHour = rangeStartHour(range, now);
  const like = `%${q.trim().toLowerCase()}%`;
  const hourFilter = fromHour === null ? "" : " AND hour >= ?";
  const hourParams: SqlValue[] = fromHour === null ? [] : [fromHour];
  const rows = db.all<{
    id: string;
    email: string;
    created_at: number;
    last_login_at: number | null;
    last_hour: number | null;
    opens: number;
    refreshes: number;
    actions: number;
  }>(
    `SELECT u.id, u.email, u.created_at,
            (SELECT MAX(le.at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at,
            (SELECT MAX(uh.hour) FROM usage_hourly uh WHERE uh.user_id = u.id${hourFilter}) AS last_hour,
            COALESCE((SELECT SUM(uh.opens) FROM usage_hourly uh WHERE uh.user_id = u.id${hourFilter}), 0) AS opens,
            COALESCE((SELECT SUM(uh.refreshes) FROM usage_hourly uh WHERE uh.user_id = u.id${hourFilter}), 0) AS refreshes,
            COALESCE((SELECT SUM(uh.actions) FROM usage_hourly uh WHERE uh.user_id = u.id${hourFilter}), 0) AS actions
       FROM users u
      WHERE u.email LIKE ?
      ORDER BY u.created_at DESC`,
    ...hourParams,
    ...hourParams,
    ...hourParams,
    ...hourParams,
    like,
  );
  return rows.map((row) => ({
    userId: row.id,
    email: row.email,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastHour: row.last_hour,
    opens: asCount(row.opens),
    refreshes: asCount(row.refreshes),
    actions: asCount(row.actions),
  }));
}

export function adminUserDetail(db: Db, now: number, range: RangeId, userId: string) {
  const user = db.get<{ id: string; email: string; created_at: number }>(
    "SELECT id, email, created_at FROM users WHERE id = ?",
    userId,
  );
  if (!user) {
    return null;
  }
  const fromMs = rangeStartMs(range, now);
  const fromHour = rangeStartHour(range, now);
  const loginsQ = since(
    "SELECT at, kind, ip, session_id FROM login_events WHERE user_id = ?",
    fromMs,
    "at",
  );
  const logins = db.all<{ at: number; kind: string; ip: string; session_id: string }>(
    `${loginsQ.sql} ORDER BY at DESC`,
    userId,
    ...loginsQ.params,
  );
  const byAppQ = since(
    "SELECT app_id, COALESCE(SUM(opens), 0) AS opens, COALESCE(SUM(refreshes), 0) AS refreshes, COALESCE(SUM(actions), 0) AS actions FROM usage_hourly WHERE user_id = ?",
    fromHour,
    "hour",
  );
  const byApp = db.all<{
    app_id: string;
    opens: number;
    refreshes: number;
    actions: number;
  }>(`${byAppQ.sql} GROUP BY app_id ORDER BY app_id`, userId, ...byAppQ.params);
  const sessionsQ = since(
    "SELECT session_id, ip, COALESCE(SUM(opens), 0) AS opens, COALESCE(SUM(refreshes), 0) AS refreshes, COALESCE(SUM(actions), 0) AS actions, MAX(hour) AS last_hour FROM usage_hourly WHERE user_id = ?",
    fromHour,
    "hour",
  );
  const sessions = db.all<{
    session_id: string;
    ip: string;
    opens: number;
    refreshes: number;
    actions: number;
    last_hour: number;
  }>(
    `${sessionsQ.sql} GROUP BY session_id ORDER BY last_hour DESC`,
    userId,
    ...sessionsQ.params,
  );
  return {
    userId: user.id,
    email: user.email,
    createdAt: user.created_at,
    logins: logins.map((row) => ({
      at: row.at,
      kind: row.kind,
      ip: row.ip,
      sessionId: row.session_id,
    })),
    byApp: byApp.map((row) => ({
      appId: row.app_id,
      opens: asCount(row.opens),
      refreshes: asCount(row.refreshes),
      actions: asCount(row.actions),
    })),
    sessions: sessions.map((row) => ({
      sessionId: row.session_id,
      ip: row.ip,
      opens: asCount(row.opens),
      refreshes: asCount(row.refreshes),
      actions: asCount(row.actions),
      lastHour: row.last_hour,
    })),
  };
}

export function adminLogins(db: Db, now: number, range: RangeId) {
  const fromMs = rangeStartMs(range, now);
  const q = since(
    `SELECT le.at, le.kind, le.ip, le.session_id, u.email
       FROM login_events le
       JOIN users u ON u.id = le.user_id`,
    fromMs,
    "le.at",
  );
  const rows = db.all<{
    at: number;
    kind: string;
    ip: string;
    session_id: string;
    email: string;
  }>(`${q.sql} ORDER BY le.at DESC LIMIT 1000`, ...q.params);
  return rows.map((row) => ({
    at: row.at,
    kind: row.kind,
    ip: row.ip,
    sessionId: row.session_id,
    email: row.email,
  }));
}

function usageFilters(
  fromHour: number | null,
  filters: { appId?: string; userId?: string; sessionId?: string },
): { sql: string; params: SqlValue[] } {
  let sql = " FROM usage_hourly WHERE 1 = 1";
  const params: SqlValue[] = [];
  if (fromHour !== null) {
    sql += " AND hour >= ?";
    params.push(fromHour);
  }
  if (filters.appId) {
    sql += " AND app_id = ?";
    params.push(filters.appId);
  }
  if (filters.userId) {
    sql += " AND user_id = ?";
    params.push(filters.userId);
  }
  if (filters.sessionId) {
    sql += " AND session_id = ?";
    params.push(filters.sessionId);
  }
  return { sql, params };
}

export function adminActivity(
  db: Db,
  now: number,
  range: RangeId,
  filters: { appId?: string; userId?: string; sessionId?: string },
  limit = 2000,
) {
  const fromHour = rangeStartHour(range, now);
  const where = usageFilters(fromHour, filters);
  const totalsRow = db.get<Counts>(
    `SELECT COALESCE(SUM(opens), 0) AS opens, COALESCE(SUM(refreshes), 0) AS refreshes, COALESCE(SUM(actions), 0) AS actions${where.sql}`,
    ...where.params,
  );
  const byApp = db.all<{
    app_id: string;
    opens: number;
    refreshes: number;
    actions: number;
    sessions: number;
    users: number;
  }>(
    `SELECT app_id, COALESCE(SUM(opens), 0) AS opens, COALESCE(SUM(refreshes), 0) AS refreshes, COALESCE(SUM(actions), 0) AS actions, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT user_id) AS users${where.sql} GROUP BY app_id ORDER BY app_id`,
    ...where.params,
  );
  const rows = db.all<{
    hour: number;
    app_id: string;
    session_id: string;
    user_id: string | null;
    opens: number;
    refreshes: number;
    actions: number;
    ip: string;
  }>(
    `SELECT hour, app_id, session_id, user_id, opens, refreshes, actions, ip${where.sql} ORDER BY hour DESC, app_id, session_id LIMIT ?`,
    ...where.params,
    limit,
  );
  const emails = new Map<string, string>();
  for (const row of db.all<{ id: string; email: string }>("SELECT id, email FROM users")) {
    emails.set(row.id, row.email);
  }
  return {
    totals: {
      opens: asCount(totalsRow?.opens),
      refreshes: asCount(totalsRow?.refreshes),
      actions: asCount(totalsRow?.actions),
    },
    byApp: byApp.map((row) => ({
      appId: row.app_id,
      opens: asCount(row.opens),
      refreshes: asCount(row.refreshes),
      actions: asCount(row.actions),
      sessions: asCount(row.sessions),
      users: asCount(row.users),
    })),
    sessions: rows.map((row) => ({
      hour: row.hour,
      appId: row.app_id,
      sessionId: row.session_id,
      userId: row.user_id,
      email: row.user_id ? (emails.get(row.user_id) ?? "") : "",
      ip: row.ip,
      opens: asCount(row.opens),
      refreshes: asCount(row.refreshes),
      actions: asCount(row.actions),
    })),
  };
}

export function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell)).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
