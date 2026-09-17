/**
 * Dual-Navigator fixture runner (TypeScript).
 * JSON files in tests/fixtures/navigator/ are the shared spec; the Swift
 * package under ios/ runs the same files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Display } from "../../src/core/display.ts";
import { NavigationMapStore } from "../../src/core/navigationMap.ts";
import { Navigator } from "../../src/core/navigator.ts";
import { NodeCache } from "../../src/core/nodeCache.ts";
import { PlatformCapabilities } from "../../src/core/platform.ts";
import { AppRegistry } from "../../src/core/registry.ts";
import { isRefreshResult } from "../../src/core/refreshResult.ts";
import { Stack } from "../../src/core/stack.ts";
import type {
  AppLocation,
  AppModule,
  NavIntent,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../src/core/types.ts";

export const NAVIGATOR_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "navigator",
);

export type FixtureReply = {
  result?: RefreshResult;
  patch?: Partial<RefreshResult> & { node?: NodePayload };
  error?: "transport" | "malformed";
  hold?: string;
};

export type FixtureGraph = {
  appId: string;
  nodes: NodePayload[];
  map: NavigationMap;
  openTips: Record<string, string>;
  nullLocationIds?: string[];
};

export type FixtureApp = {
  graph?: FixtureGraph;
  open?: Record<string, FixtureReply | FixtureReply[]>;
  refresh?: Record<string, FixtureReply | FixtureReply[]>;
};

export type FixtureExpect = {
  label?: string;
  kind?: "text" | "input";
  tipId?: string;
  stack?: string[];
  frames?: Array<string | null>;
  blocked?: boolean;
  address?: AppLocation;
  external?: string;
  clipboard?: string;
  lastCall?: {
    method?: "open" | "refresh";
    appId?: string;
    nodeId?: string;
    path?: string;
    extras?: {
      action?: { triggerId: string } | null;
      inputText?: string;
      parkedAppIds?: string[];
    };
  };
};

export type FixtureStep =
  | { open: { appId: string; path: string }; intent?: never; setInput?: never; release?: never; expect?: never }
  | { intent: string; open?: never; setInput?: never; release?: never; expect?: never }
  | { setInput: string; open?: never; intent?: never; release?: never; expect?: never }
  | { release: string; open?: never; intent?: never; setInput?: never; expect?: never }
  | { expect: FixtureExpect; open?: never; intent?: never; setInput?: never; release?: never };

export type NavigatorFixture = {
  id: string;
  appsFrom?: string;
  config?: {
    rootAppId?: string;
    recentsAppId?: string | null;
    clipboard?: "ok" | "unavailable";
  };
  apps?: Record<string, FixtureApp>;
  steps?: FixtureStep[];
  decode?: { accept: boolean; payload: unknown };
};

export type FixtureCall = {
  method: "open" | "refresh";
  appId: string;
  path?: string;
  nodeId?: string;
  extras: RefreshExtras;
};

type ReplyQueue = { reusable: boolean; items: FixtureReply[] };
type QueueMap = Record<string, ReplyQueue>;

export function listNavigatorFixtureFiles(): string[] {
  return readdirSync(NAVIGATOR_FIXTURE_DIR)
    .filter((name) => name.endsWith(".json") && name !== "schema.json")
    .map((name) => join(NAVIGATOR_FIXTURE_DIR, name))
    .sort();
}

export function loadNavigatorFixture(path: string): NavigatorFixture {
  const raw = JSON.parse(readFileSync(path, "utf8")) as NavigatorFixture;
  if (!raw.id) {
    throw new Error(`Fixture ${path} is missing id`);
  }
  if (raw.appsFrom) {
    const base = JSON.parse(
      readFileSync(join(NAVIGATOR_FIXTURE_DIR, "apps", `${raw.appsFrom}.json`), "utf8"),
    ) as Record<string, FixtureApp>;
    raw.apps = mergeApps(base, raw.apps ?? {});
  }
  return raw;
}

function mergeApps(
  base: Record<string, FixtureApp>,
  overlay: Record<string, FixtureApp>,
): Record<string, FixtureApp> {
  const out: Record<string, FixtureApp> = { ...base };
  for (const [id, app] of Object.entries(overlay)) {
    const prior = out[id];
    if (!prior) {
      out[id] = app;
      continue;
    }
    out[id] = {
      graph: app.graph ?? prior.graph,
      open: { ...prior.open, ...app.open },
      refresh: { ...prior.refresh, ...app.refresh },
    };
  }
  return out;
}

function asQueue(value: FixtureReply | FixtureReply[] | undefined): ReplyQueue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return { reusable: false, items: [...value] };
  }
  return { reusable: true, items: [value] };
}

function nodeById(graph: FixtureGraph, id: string): NodePayload {
  return graph.nodes.find((n) => n.id === id) ?? { id, label: id };
}

function locationFor(graph: FixtureGraph, tipId: string): AppLocation | null {
  if (graph.nullLocationIds?.includes(tipId)) {
    return null;
  }
  if (graph.openTips["/"] === tipId) {
    return { appId: graph.appId, path: "/" };
  }
  return { appId: graph.appId, path: `/${tipId}` };
}

function resultFromGraph(graph: FixtureGraph, tipId: string): RefreshResult {
  const node = nodeById(graph, tipId);
  return {
    navigationMap: graph.map,
    warm: graph.nodes,
    node,
    location: locationFor(graph, tipId),
  };
}

function applyPatch(base: RefreshResult, patch: NonNullable<FixtureReply["patch"]>): RefreshResult {
  return {
    ...base,
    ...patch,
    node: patch.node ?? base.node,
    navigationMap: patch.navigationMap ?? base.navigationMap,
    warm: patch.warm ?? base.warm,
    location: patch.location !== undefined ? patch.location : base.location,
  };
}

function openTipId(graph: FixtureGraph, path: string): string {
  return graph.openTips[path] ?? path.replace(/^\//, "") ?? graph.nodes[0]!.id;
}

class ScriptedRpc {
  calls: FixtureCall[] = [];
  unheldBusy = 0;
  heldBusy = 0;
  private readonly released = new Set<string>();
  private readonly waiters = new Map<string, () => void>();
  private readonly openQueues = new Map<string, QueueMap>();
  private readonly refreshQueues = new Map<string, QueueMap>();
  private readonly graphs = new Map<string, FixtureGraph>();

  constructor(apps: Record<string, FixtureApp>) {
    for (const [id, app] of Object.entries(apps)) {
      if (app.graph) {
        this.graphs.set(id, app.graph);
      }
      const open: QueueMap = {};
      for (const [path, reply] of Object.entries(app.open ?? {})) {
        const queue = asQueue(reply);
        if (queue) {
          open[path] = queue;
        }
      }
      this.openQueues.set(id, open);
      const refresh: QueueMap = {};
      for (const [nodeId, reply] of Object.entries(app.refresh ?? {})) {
        const queue = asQueue(reply);
        if (queue) {
          refresh[nodeId] = queue;
        }
      }
      this.refreshQueues.set(id, refresh);
    }
  }

  modules(): AppModule[] {
    return [...new Set([...this.graphs.keys(), ...this.openQueues.keys(), ...this.refreshQueues.keys()])].map(
      (id) => this.module(id),
    );
  }

  release(name: string): void {
    this.released.add(name);
    const waiter = this.waiters.get(name);
    if (waiter) {
      this.waiters.delete(name);
      waiter();
    }
  }

  private takeReply(queues: Map<string, QueueMap>, appId: string, key: string): FixtureReply {
    const queue = queues.get(appId)?.[key];
    if (!queue || queue.items.length === 0) {
      return {};
    }
    if (queue.reusable) {
      return queue.items[0]!;
    }
    return queue.items.shift()!;
  }

  private async waitHold(name: string, signal?: AbortSignal): Promise<void> {
    if (this.released.has(name)) {
      return;
    }
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.waiters.delete(name);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(name, () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }

  private async fulfill(
    appId: string,
    method: "open" | "refresh",
    key: string,
    extras: RefreshExtras,
    path?: string,
    nodeId?: string,
  ): Promise<RefreshResult> {
    const queues = method === "open" ? this.openQueues : this.refreshQueues;
    const reply = this.takeReply(queues, appId, key);
    this.calls.push({ method, appId, path, nodeId, extras: { ...extras } });

    const held = Boolean(reply.hold);
    if (held) {
      this.heldBusy += 1;
    } else {
      this.unheldBusy += 1;
    }
    try {
      if (reply.hold) {
        await this.waitHold(reply.hold, extras.signal);
      }
      if (reply.error === "malformed") {
        throw new Error("Navigator: malformed RefreshResult");
      }
      if (reply.error === "transport") {
        throw new Error("transport");
      }
      const graph = this.graphs.get(appId);
      let result: RefreshResult | undefined = reply.result;
      if (!result && graph) {
        const tipId = method === "open" ? openTipId(graph, key) : key;
        result = resultFromGraph(graph, tipId);
      }
      if (!result) {
        throw new Error(`No result for ${method} ${appId} ${key}`);
      }
      if (reply.patch) {
        result = applyPatch(result, reply.patch);
      }
      return result;
    } finally {
      if (held) {
        this.heldBusy -= 1;
      } else {
        this.unheldBusy -= 1;
      }
    }
  }

  private module(id: string): AppModule {
    const rpc = this;
    return {
      id,
      label: id,
      open: (path, extras = {}) => rpc.fulfill(id, "open", path, extras, path, undefined),
      refresh: (nodeId, extras = {}) => rpc.fulfill(id, "refresh", nodeId, extras, undefined, nodeId),
    };
  }
}

function visibleText(root: HTMLElement): string {
  const input = root.querySelector<HTMLTextAreaElement | HTMLInputElement>("[data-surface='input']");
  if (input) {
    return input.value;
  }
  const text = root.querySelector("[data-surface='text']");
  if (text) {
    return text.textContent ?? "";
  }
  return root.textContent ?? "";
}

function visibleKind(root: HTMLElement): "text" | "input" {
  return root.querySelector("[data-surface='input']") ? "input" : "text";
}

async function settle(nav: Navigator, rpc: ScriptedRpc): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await Promise.resolve();
    await Promise.resolve();
    if (rpc.unheldBusy > 0) {
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    if (nav.hasInFlight() && rpc.heldBusy === 0) {
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    return;
  }
  throw new Error("Fixture settle timed out");
}

function extrasMatch(
  actual: RefreshExtras,
  expected: NonNullable<NonNullable<FixtureExpect["lastCall"]>["extras"]>,
): string | null {
  if (expected.action === null) {
    if (actual.action) {
      return `expected no action, got ${JSON.stringify(actual.action)}`;
    }
  } else if (expected.action) {
    if (actual.action?.triggerId !== expected.action.triggerId) {
      return `action triggerId ${actual.action?.triggerId} != ${expected.action.triggerId}`;
    }
  }
  if (expected.inputText !== undefined && actual.inputText !== expected.inputText) {
    return `inputText ${JSON.stringify(actual.inputText)} != ${JSON.stringify(expected.inputText)}`;
  }
  if (expected.parkedAppIds !== undefined) {
    const got = actual.parkedAppIds ?? [];
    if (got.length !== expected.parkedAppIds.length || got.some((id, i) => id !== expected.parkedAppIds![i])) {
      return `parkedAppIds ${JSON.stringify(got)} != ${JSON.stringify(expected.parkedAppIds)}`;
    }
  }
  return null;
}

function checkExpect(args: {
  expect: FixtureExpect;
  nav: Navigator;
  stack: Stack;
  root: HTMLElement;
  addressLog: AppLocation[];
  externalLog: string[];
  clipboardLog: string[];
  rpc: ScriptedRpc;
}): string[] {
  const errors: string[] = [];
  const { expect: exp } = args;
  if (exp.label !== undefined && visibleText(args.root) !== exp.label) {
    errors.push(`label ${JSON.stringify(visibleText(args.root))} != ${JSON.stringify(exp.label)}`);
  }
  if (exp.kind !== undefined && visibleKind(args.root) !== exp.kind) {
    errors.push(`kind ${visibleKind(args.root)} != ${exp.kind}`);
  }
  if (exp.tipId !== undefined && args.stack.tip()?.nodeId !== exp.tipId) {
    errors.push(`tipId ${args.stack.tip()?.nodeId} != ${exp.tipId}`);
  }
  if (exp.stack) {
    const got = args.stack.snapshot().map((e) => e.nodeId);
    if (got.join("\0") !== exp.stack.join("\0")) {
      errors.push(`stack ${JSON.stringify(got)} != ${JSON.stringify(exp.stack)}`);
    }
  }
  if (exp.frames) {
    const got = args.stack.snapshot().map((e) => e.frame ?? null);
    if (JSON.stringify(got) !== JSON.stringify(exp.frames)) {
      errors.push(`frames ${JSON.stringify(got)} != ${JSON.stringify(exp.frames)}`);
    }
  }
  if (exp.blocked !== undefined && args.nav.isBlocked() !== exp.blocked) {
    errors.push(`blocked ${args.nav.isBlocked()} != ${exp.blocked}`);
  }
  if (exp.address) {
    const last = args.addressLog.at(-1);
    if (!last || last.appId !== exp.address.appId || last.path !== exp.address.path) {
      errors.push(`address ${JSON.stringify(last)} != ${JSON.stringify(exp.address)}`);
    }
  }
  if (exp.external !== undefined && args.externalLog.at(-1) !== exp.external) {
    errors.push(`external ${JSON.stringify(args.externalLog.at(-1))} != ${JSON.stringify(exp.external)}`);
  }
  if (exp.clipboard !== undefined && args.clipboardLog.at(-1) !== exp.clipboard) {
    errors.push(`clipboard ${JSON.stringify(args.clipboardLog.at(-1))} != ${JSON.stringify(exp.clipboard)}`);
  }
  if (exp.lastCall) {
    const last = args.rpc.calls.at(-1);
    if (!last) {
      errors.push("lastCall missing");
    } else {
      if (exp.lastCall.method && last.method !== exp.lastCall.method) {
        errors.push(`lastCall.method ${last.method} != ${exp.lastCall.method}`);
      }
      if (exp.lastCall.appId && last.appId !== exp.lastCall.appId) {
        errors.push(`lastCall.appId ${last.appId} != ${exp.lastCall.appId}`);
      }
      if (exp.lastCall.nodeId && last.nodeId !== exp.lastCall.nodeId) {
        errors.push(`lastCall.nodeId ${last.nodeId} != ${exp.lastCall.nodeId}`);
      }
      if (exp.lastCall.path && last.path !== exp.lastCall.path) {
        errors.push(`lastCall.path ${last.path} != ${exp.lastCall.path}`);
      }
      if (exp.lastCall.extras) {
        const mismatch = extrasMatch(last.extras, exp.lastCall.extras);
        if (mismatch) {
          errors.push(`lastCall.extras ${mismatch}`);
        }
      }
    }
  }
  return errors;
}

export function runDecodeFixture(fixture: NavigatorFixture): void {
  const spec = fixture.decode;
  if (!spec) {
    throw new Error(`${fixture.id} is not a decode fixture`);
  }
  const accepted = isRefreshResult(spec.payload);
  if (accepted !== spec.accept) {
    throw new Error(
      `${fixture.id}: isRefreshResult=${accepted}, expected accept=${spec.accept}`,
    );
  }
}

export async function runNavigatorFixture(fixture: NavigatorFixture): Promise<void> {
  if (fixture.decode) {
    runDecodeFixture(fixture);
    return;
  }
  if (!fixture.steps || !fixture.apps) {
    throw new Error(`${fixture.id} has no steps/apps`);
  }

  const root = document.createElement("div");
  document.body.appendChild(root);
  const display = new Display(root);
  const registry = new AppRegistry();
  const rpc = new ScriptedRpc(fixture.apps);
  for (const app of rpc.modules()) {
    registry.register(app);
  }

  const clipboardLog: string[] = [];
  const addressLog: AppLocation[] = [];
  const externalLog: string[] = [];
  const clipboard =
    fixture.config?.clipboard === "unavailable"
      ? null
      : {
          writeText: async (text: string) => {
            clipboardLog.push(text);
          },
        };

  const map = new NavigationMapStore();
  const cache = new NodeCache();
  const stack = new Stack();
  const navigator = new Navigator({
    config: {
      rootAppId: fixture.config?.rootAppId ?? "home",
      recentsAppId: fixture.config?.recentsAppId === null ? undefined : fixture.config?.recentsAppId,
    },
    registry,
    display,
    platform: new PlatformCapabilities({ clipboard }),
    map,
    cache,
    stack,
    setAddressBar: (location) => {
      addressLog.push(location);
    },
    handOffExternal: (href) => {
      externalLog.push(href);
    },
  });

  try {
    for (const [i, step] of fixture.steps.entries()) {
      if ("open" in step && step.open) {
        void navigator.openLocation(step.open);
        await settle(navigator, rpc);
        continue;
      }
      if ("intent" in step && step.intent) {
        void navigator.onIntent(step.intent as NavIntent);
        await settle(navigator, rpc);
        continue;
      }
      if ("setInput" in step && step.setInput !== undefined) {
        const input = root.querySelector<HTMLTextAreaElement | HTMLInputElement>("[data-surface='input']");
        if (!input) {
          throw new Error(`${fixture.id} step ${i}: setInput with no input surface`);
        }
        input.value = step.setInput;
        continue;
      }
      if ("release" in step && step.release) {
        rpc.release(step.release);
        await settle(navigator, rpc);
        continue;
      }
      if ("expect" in step && step.expect) {
        const errors = checkExpect({
          expect: step.expect,
          nav: navigator,
          stack,
          root,
          addressLog,
          externalLog,
          clipboardLog,
          rpc,
        });
        if (errors.length > 0) {
          throw new Error(`${fixture.id} step ${i}: ${errors.join("; ")}`);
        }
      }
    }
  } finally {
    root.remove();
  }
}
