import type { Db } from "./db/index.ts";

export const HOUR_MS = 3_600_000;

export type UsageKind = "open" | "refresh" | "action";

export function hourBucket(at: number): number {
  return Math.floor(at / HOUR_MS);
}

export function usageKind(
  dispatchKind: "open" | "refresh",
  extras: { readonly action?: boolean },
): UsageKind {
  if (extras.action) {
    return "action";
  }
  return dispatchKind;
}

export function recordUsage(
  db: Db,
  args: {
    readonly at: number;
    readonly appId: string;
    readonly sessionId: string;
    readonly userId: string | null;
    readonly kind: UsageKind;
    readonly ip: string;
  },
): void {
  const hour = hourBucket(args.at);
  const opens = args.kind === "open" ? 1 : 0;
  const refreshes = args.kind === "refresh" ? 1 : 0;
  const actions = args.kind === "action" ? 1 : 0;
  db.run(
    `INSERT INTO usage_hourly (hour, app_id, session_id, user_id, opens, refreshes, actions, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hour, app_id, session_id) DO UPDATE SET
       user_id = COALESCE(excluded.user_id, usage_hourly.user_id),
       opens = usage_hourly.opens + excluded.opens,
       refreshes = usage_hourly.refreshes + excluded.refreshes,
       actions = usage_hourly.actions + excluded.actions,
       ip = excluded.ip`,
    hour,
    args.appId,
    args.sessionId,
    args.userId,
    opens,
    refreshes,
    actions,
    args.ip,
  );
}
