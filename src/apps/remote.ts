import type { AppModule, RefreshExtras, StackEntry } from "../core/types.ts";
import { toWireExtras, type AppRpc } from "./rpc.ts";

export type RemoteAppOptions = {
  readonly id: string;
  readonly label: string;
  readonly rpc: AppRpc;
};

/**
 * Client-side AppModule that forwards open/refresh to an AppRpc.
 * Same stub for every server app — not Bible-specific.
 */
export function createRemoteApp(options: RemoteAppOptions): AppModule {
  const { id, label, rpc } = options;
  return {
    id,
    label,
    open(path: string, extras: RefreshExtras = {}) {
      return rpc.open(id, path, toWireExtras(extras), extras.signal);
    },
    refresh(stack: readonly StackEntry[], extras: RefreshExtras = {}) {
      return rpc.refresh(id, stack, toWireExtras(extras), extras.signal);
    },
  };
}
