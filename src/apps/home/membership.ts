import type { AppDescriptor, HomeRole } from "../../core/types.ts";
import { HOME_APP_ID } from "./ids.ts";

export function roleOf(app: AppDescriptor): HomeRole {
  return app.homeRole ?? "optional";
}

/** Installed apps that can appear on Home's list (not self, not internal). */
export function catalogPeers(directory: readonly AppDescriptor[]): AppDescriptor[] {
  return directory.filter((app) => app.id !== HOME_APP_ID && roleOf(app) !== "internal");
}

export function defaultVisible(peers: readonly AppDescriptor[]): AppDescriptor[] {
  return peers.filter((app) => {
    const role = roleOf(app);
    return role === "required" || role === "default";
  });
}

/**
 * Home list membership for a signed-in user.
 * Empty `stored` → default ∪ required in directory order.
 * Required apps missing from `stored` are appended.
 */
export function visibleFromStore(
  peers: readonly AppDescriptor[],
  stored: readonly string[],
): AppDescriptor[] {
  if (stored.length === 0) {
    return defaultVisible(peers);
  }
  const byId = new Map(peers.map((app) => [app.id, app]));
  const out: AppDescriptor[] = [];
  const seen = new Set<string>();
  for (const id of stored) {
    const app = byId.get(id);
    if (!app) {
      continue;
    }
    const role = roleOf(app);
    if (role === "internal") {
      continue;
    }
    out.push(app);
    seen.add(app.id);
  }
  for (const app of peers) {
    if (roleOf(app) === "required" && !seen.has(app.id)) {
      out.push(app);
    }
  }
  return out;
}

export function addableApps(
  peers: readonly AppDescriptor[],
  visible: readonly AppDescriptor[],
): AppDescriptor[] {
  const onHome = new Set(visible.map((app) => app.id));
  return peers.filter((app) => {
    const role = roleOf(app);
    return (role === "default" || role === "optional") && !onHome.has(app.id);
  });
}

export function removableApps(visible: readonly AppDescriptor[]): AppDescriptor[] {
  return visible.filter((app) => {
    const role = roleOf(app);
    return role === "default" || role === "optional";
  });
}

export function canManage(app: AppDescriptor): boolean {
  const role = roleOf(app);
  return role === "default" || role === "optional";
}
