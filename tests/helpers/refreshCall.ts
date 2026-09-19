import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../src/core/types.ts";

/** `action: true` is test shorthand; only apps see the real `{ triggerId }`. */
export type TestExtras = Omit<RefreshExtras, "action"> & {
  action?: RefreshExtras["action"] | true;
};

/** Test convenience: `action: true` becomes `{ triggerId }` for the tip. */
export function wireAction(extras: TestExtras, nodeId: string): RefreshExtras {
  if (extras.action === true) {
    return { ...extras, action: { triggerId: nodeId } };
  }
  return extras as RefreshExtras;
}

export function refreshApp(
  app: Pick<AppModule, "refresh">,
  nodeId: string,
  extras: TestExtras = {},
  ctx?: AppServerContext,
): RefreshResult | Promise<RefreshResult> {
  return app.refresh(nodeId, wireAction(extras, nodeId), ctx);
}
