import type {
  AppLocation,
  AppModule,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../src/core/types.ts";

export type FakeCall = {
  method: "open" | "refresh";
  path?: string;
  stack?: readonly StackEntry[];
  extras: RefreshExtras;
};

export type FakeAppOptions = {
  id: string;
  label: string;
  rootAppId: string;
  /** Controllable async gate: resolve the pending deferred to continue. */
  gate?: () => Promise<void>;
};

/**
 * Tiny AppModule for Navigator/Router contract tests.
 * Graph: root ↔ sibling list ↔ child; Copy action; input commit; app back to root.
 */
export function createFakeApp(options: FakeAppOptions): {
  app: AppModule;
  calls: FakeCall[];
  effects: string[];
  setNodeLabel: (id: string, label: string) => void;
} {
  const calls: FakeCall[] = [];
  const effects: string[] = [];
  const labels = new Map<string, string>([
    ["root", "Root"],
    ["a", "A"],
    ["b", "B"],
    ["child", "Child"],
    ["copy", "Copy"],
    ["copy-status", "Copying…"],
    ["input", ""],
    ["sent", "Sending…"],
  ]);

  function payload(id: string, kind?: NodePayload["kind"]): NodePayload {
    return { id, label: labels.get(id) ?? id, kind };
  }

  function mapFor(): NavigationMap {
    const rootBack = {
      back: {
        kind: "app" as const,
        to: { appId: options.rootAppId, path: "/" } satisfies AppLocation,
      },
    };

    const base: NavigationMap = {
      root: {
        next: { kind: "node", toNodeId: "a", stackBehavior: "replace" },
        enter: { kind: "node", toNodeId: "child", stackBehavior: "push" },
        ...rootBack,
      },
      a: {
        prev: { kind: "node", toNodeId: "root", stackBehavior: "replace" },
        next: { kind: "node", toNodeId: "b", stackBehavior: "replace" },
        enter: { kind: "node", toNodeId: "copy", stackBehavior: "push" },
        ...rootBack,
      },
      b: {
        prev: { kind: "node", toNodeId: "a", stackBehavior: "replace" },
        next: { kind: "node", toNodeId: "copy", stackBehavior: "replace" },
        ...rootBack,
      },
      copy: {
        prev: { kind: "node", toNodeId: "b", stackBehavior: "replace" },
        next: { kind: "node", toNodeId: "a", stackBehavior: "replace" },
        enter: {
          kind: "node",
          toNodeId: "copy-status",
          stackBehavior: "push",
          action: true,
        },
        back: { kind: "node", stackBehavior: "pop" },
      },
      "copy-status": {
        back: { kind: "node", stackBehavior: "pop" },
      },
      child: {
        back: { kind: "node", stackBehavior: "pop" },
        enter: { kind: "node", toNodeId: "input", stackBehavior: "push" },
      },
      input: {
        enter: {
          kind: "node",
          toNodeId: "sent",
          stackBehavior: "push",
          passInputText: true,
          action: true,
        },
        back: { kind: "node", stackBehavior: "pop" },
      },
      sent: {
        back: { kind: "node", stackBehavior: "pop" },
      },
    };
    return base;
  }

  function warmAround(tip: NodePayload): NodePayload[] {
    return [
      payload("root"),
      payload("a"),
      payload("b"),
      payload("child"),
      payload("copy"),
      payload("copy-status"),
      payload("input", "input"),
      payload("sent"),
      tip,
    ];
  }

  async function respond(
    method: "open" | "refresh",
    tipId: string,
    extras: RefreshExtras,
    path?: string,
    stack?: readonly StackEntry[],
  ): Promise<RefreshResult> {
    const plannedLabel = labels.get(tipId) ?? tipId;
    calls.push({ method, path, stack, extras: { ...extras } });
    if (options.gate) {
      await options.gate();
    }
    if (extras.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (extras.action && tipId === "copy-status") {
      effects.push("copy");
      labels.set("copy-status", "Copied");
      await extras.platform?.clipboard?.writeText("copied-text");
    }
    if (extras.action && tipId === "sent") {
      effects.push(`send:${extras.inputText ?? ""}`);
      labels.set("sent", "Sent");
    }

    const label = labels.get(tipId) ?? plannedLabel;
    const node: NodePayload =
      tipId === "input"
        ? { id: "input", label, kind: "input" }
        : { id: tipId, label };
    const location: AppLocation | null =
      tipId === "copy-status" || tipId === "sent"
        ? null
        : { appId: options.id, path: path ?? `/${tipId}` };

    return {
      navigationMap: mapFor(),
      warm: warmAround(node),
      node,
      location,
    };
  }

  const app: AppModule = {
    id: options.id,
    label: options.label,
    async open(path, extras = {}) {
      const tipId = path === "/" ? "root" : path.replace(/^\//, "");
      return respond("open", tipId, extras, path);
    },
    async refresh(stack, extras = {}) {
      const tipId = stack[stack.length - 1]?.nodeId ?? "root";
      return respond("refresh", tipId, extras, undefined, stack);
    },
  };

  return {
    app,
    calls,
    effects,
    setNodeLabel: (id, label) => {
      labels.set(id, label);
    },
  };
}

export function createRootApp(rootAppId: string): AppModule {
  const map: NavigationMap = {
    "home-root": {
      enter: {
        kind: "app",
        to: { appId: "fake", path: "/" },
      },
    },
  };
  return {
    id: rootAppId,
    label: "Home",
    open: () => ({
      navigationMap: map,
      warm: [{ id: "home-root", label: "Home" }],
      node: { id: "home-root", label: "Home" },
      location: { appId: rootAppId, path: "/" },
    }),
    refresh: (stack) => {
      const tip = stack[stack.length - 1];
      return {
        navigationMap: map,
        warm: [{ id: "home-root", label: "Home" }],
        node: { id: tip?.nodeId ?? "home-root", label: tip?.label ?? "Home" },
        location: { appId: rootAppId, path: "/" },
      };
    },
  };
}
