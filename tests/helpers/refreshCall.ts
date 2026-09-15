import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../src/core/types.ts";

type Stackish = string | readonly { readonly nodeId: string }[];

export function nodeIdOf(stack: Stackish): string {
  return typeof stack === "string" ? stack : (stack[stack.length - 1]?.nodeId ?? "");
}

/** Test convenience: `action: true` becomes `{ triggerId }` for the tip. */
export function wireAction(
  extras: RefreshExtras & { action?: unknown },
  nodeId: string,
): RefreshExtras {
  if (extras.action === true) {
    const { action: _ignored, ...rest } = extras;
    return { ...rest, action: { triggerId: nodeId } };
  }
  return extras;
}

export function refreshApp(
  app: Pick<AppModule, "refresh">,
  stack: Stackish,
  extras: RefreshExtras & { action?: unknown } = {},
  ctx?: AppServerContext,
): RefreshResult | Promise<RefreshResult> {
  const nodeId = nodeIdOf(stack);
  return app.refresh(nodeId, wireAction(extras, nodeId), ctx);
}
