import type { Display } from "./display.ts";
import type { NavigationMapStore } from "./navigationMap.ts";
import type { NodeCache } from "./nodeCache.ts";
import type { PlatformCapabilities } from "./platform.ts";
import type { AppRegistry } from "./registry.ts";
import type { Stack } from "./stack.ts";
import type {
  AppLocation,
  AppModule,
  NavEdge,
  NavIntent,
  NodeKind,
  NodePayload,
  RefreshExtras,
  RefreshResult,
  ShellConfig,
  StackBehavior,
  StackEntry,
} from "./types.ts";

export interface NavigatorOptions {
  readonly config: ShellConfig;
  readonly registry: AppRegistry;
  readonly display: Display;
  readonly platform: PlatformCapabilities;
  readonly map: NavigationMapStore;
  readonly cache: NodeCache;
  readonly stack: Stack;
  /** Address-bar writes go through Router.setAddressBar — never mint `#` here. */
  readonly setAddressBar: (location: AppLocation) => void;
  /** `kind: "external"` hand-off. Injected for tests. */
  readonly handOffExternal?: (href: string) => void;
}

type InFlight = {
  token: number;
  controller: AbortController;
  isAction: boolean;
};

/**
 * Single owner of every state transition: stack, cache, map, blocked, display,
 * address bar, and the monotonic transition token.
 */
export class Navigator {
  private readonly config: ShellConfig;
  private readonly registry: AppRegistry;
  private readonly display: Display;
  private readonly platform: PlatformCapabilities;
  private readonly map: NavigationMapStore;
  private readonly cache: NodeCache;
  private readonly stack: Stack;
  private readonly setAddressBar: (location: AppLocation) => void;
  private readonly handOffExternal: (href: string) => void;

  private blocked = false;
  private transitionToken = 0;
  private inFlight: InFlight | null = null;
  private currentAppId: string | null = null;
  private tipKind: NodeKind = "text";
  /**
   * What Display is actually showing. Used so a warm-hit revalidation that
   * confirms the same tip does not remount the surface (VoiceOver would
   * restart mid-utterance). Cleared on openLocation because the surface may
   * still show a prior app's tip until the new result arrives.
   */
  private displayed: {
    appId: string;
    id: string;
    kind: NodeKind;
    label: string;
  } | null = null;

  constructor(options: NavigatorOptions) {
    this.config = options.config;
    this.registry = options.registry;
    this.display = options.display;
    this.platform = options.platform;
    this.map = options.map;
    this.cache = options.cache;
    this.stack = options.stack;
    this.setAddressBar = options.setAddressBar;
    this.handOffExternal =
      options.handOffExternal ??
      ((href: string) => {
        if (typeof globalThis.location !== "undefined") {
          globalThis.location.href = href;
        }
      });
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  getTipKind(): NodeKind {
    return this.tipKind;
  }

  getCurrentAppId(): string | null {
    return this.currentAppId;
  }

  /** Test/debug: current transition token. */
  getTransitionToken(): number {
    return this.transitionToken;
  }

  onIntent(intent: NavIntent): void | Promise<void> {
    if (this.blocked) {
      return;
    }
    const tip = this.stack.tip();
    if (!tip) {
      return;
    }

    const edge = this.map.lookup(tip.nodeId, intent);
    if (!edge) {
      return;
    }

    const extras: RefreshExtras = {};
    const tipPayload = this.cache.get(tip.nodeId);
    const kind = tipPayload?.kind ?? this.tipKind;
    if (edge.kind !== "external" && edge.passInputText && kind === "input") {
      extras.inputText = this.display.getInputText();
    }
    if (edge.kind !== "external" && edge.action) {
      extras.action = true;
    }

    // Supersede anything in flight before branching.
    this.transitionToken += 1;
    const token = this.transitionToken;
    this.supersedeInFlight(extras.action === true);

    if (edge.kind === "external") {
      this.handOffExternal(edge.href);
      return;
    }

    if (edge.kind === "app") {
      return this.openLocation(edge.to, extras);
    }

    return this.followNodeEdge(edge, extras, token);
  }

  async openLocation(
    location: AppLocation,
    extras: RefreshExtras = {},
  ): Promise<void> {
    this.transitionToken += 1;
    const token = this.transitionToken;
    this.supersedeInFlight(extras.action === true);

    this.stack.clear();
    this.cache.clear();
    this.map.replace({});
    this.displayed = null;
    this.blocked = true;

    let appId = location.appId;
    let app = this.registry.get(appId);
    if (!app) {
      appId = this.config.rootAppId;
      app = this.registry.get(appId);
    }
    if (!app) {
      this.blocked = false;
      return;
    }

    this.currentAppId = appId;
    const path = location.appId === appId ? location.path : "/";

    await this.startCall({
      token,
      isAction: extras.action === true,
      invoke: (callExtras) => app.open(path, callExtras),
      baseExtras: extras,
    });
  }

  private followNodeEdge(
    edge: Extract<NavEdge, { kind: "node" }>,
    extras: RefreshExtras,
    token: number,
  ): Promise<void> | void {
    let destId: string;
    let behavior: StackBehavior = edge.stackBehavior;

    if (edge.stackBehavior === "pop") {
      this.stack.pop();
      if (this.stack.length === 0) {
        return this.openLocation({ appId: this.config.rootAppId, path: "/" });
      }
      destId = this.stack.tip()!.nodeId;
    } else {
      if (!edge.toNodeId) {
        return; // malformed push/replace → silent no-op
      }
      destId = edge.toNodeId;
    }

    const payload = this.cache.get(destId);
    if (payload) {
      this.applyLocalMove(behavior, payload, { updateDisplay: true });
      return this.startCall({
        token,
        isAction: extras.action === true,
        invoke: (callExtras) => this.currentApp()!.refresh(this.stack.snapshot(), callExtras),
        baseExtras: extras,
      });
    }

    // Warm miss: move stack, keep previous display, block until refresh.
    this.blocked = true;
    this.applyLocalMove(
      behavior,
      { id: destId, label: "" },
      { updateDisplay: false },
    );
    return this.startCall({
      token,
      isAction: extras.action === true,
      invoke: (callExtras) => this.currentApp()!.refresh(this.stack.snapshot(), callExtras),
      baseExtras: extras,
    });
  }

  private applyLocalMove(
    behavior: StackBehavior,
    payload: NodePayload,
    opts: { updateDisplay: boolean },
  ): void {
    const entry = this.entryFromPayload(payload);
    if (behavior === "push") {
      this.stack.push(entry);
    } else if (behavior === "replace") {
      this.stack.replaceTip(entry);
    } else {
      // pop: stack already adjusted; refresh tip fields from payload
      this.stack.replaceTip(entry);
    }

    if (opts.updateDisplay) {
      this.showPayload(payload);
    }
  }

  private entryFromPayload(payload: NodePayload): StackEntry {
    return {
      nodeId: payload.id,
      label: payload.label,
      location: null,
    };
  }

  private showPayload(payload: NodePayload): void {
    const kind = payload.kind ?? "text";
    this.tipKind = kind;
    if (this.currentAppId) {
      this.displayed = {
        appId: this.currentAppId,
        id: payload.id,
        kind,
        label: payload.label,
      };
    }
    if (kind === "input") {
      this.display.showInput(payload.label);
    } else {
      this.display.showText(payload.label);
    }
  }

  /**
   * True when Display already shows this tip. Text tips remount so navigation
   * announces even when labels collide; input tips match on id alone so a
   * background revalidation cannot wipe the caret or typed text.
   */
  private isAlreadyShowing(payload: NodePayload): boolean {
    if (!this.displayed || this.displayed.appId !== this.currentAppId) {
      return false;
    }
    const kind = payload.kind ?? "text";
    if (this.displayed.id !== payload.id || this.displayed.kind !== kind) {
      return false;
    }
    if (kind === "input") {
      return true;
    }
    return this.displayed.label === payload.label;
  }

  private currentApp(): AppModule | null {
    if (!this.currentAppId) {
      return null;
    }
    return this.registry.get(this.currentAppId);
  }

  private supersedeInFlight(nextIsAction: boolean): void {
    const prev = this.inFlight;
    if (!prev) {
      return;
    }
    // Action calls are never aborted — only their results are discarded.
    if (!prev.isAction) {
      prev.controller.abort();
    }
    // nextIsAction reserved for future coalescing policy; token handles correctness.
    void nextIsAction;
  }

  private async startCall(args: {
    token: number;
    isAction: boolean;
    baseExtras: RefreshExtras;
    invoke: (extras: RefreshExtras) => Promise<RefreshResult> | RefreshResult;
  }): Promise<void> {
    const controller = new AbortController();
    this.inFlight = {
      token: args.token,
      controller,
      isAction: args.isAction,
    };

    if (args.isAction) {
      this.platform.beginClipboardWrite();
    }

    const callExtras: RefreshExtras = {
      ...args.baseExtras,
      signal: controller.signal,
      platform: this.platform.createContext(),
    };
    // Action flag only when this traversal requested it — never invent on revalidation.
    if (args.isAction) {
      callExtras.action = true;
    } else {
      delete callExtras.action;
    }

    try {
      const result = await args.invoke(callExtras);
      if (args.token !== this.transitionToken) {
        return; // stale
      }
      this.applyResult(result);
      this.blocked = false;
    } catch (err) {
      if (args.token !== this.transitionToken) {
        return;
      }
      // Refresh failure: keep display; clear blocked; leave map/cache as last good.
      console.warn("Navigator: refresh/open failed", err);
      this.blocked = false;
    } finally {
      if (this.inFlight?.token === args.token) {
        this.inFlight = null;
      }
      if (args.isAction) {
        this.platform.endClipboardWrite();
      }
    }
  }

  private applyResult(result: RefreshResult): void {
    this.map.replace(result.navigationMap);

    const tipEntry: StackEntry = {
      nodeId: result.node.id,
      label: result.node.label,
      location:
        result.location === undefined || result.location === null
          ? (this.stack.tip()?.location ?? null)
          : result.location,
    };

    if (this.stack.length === 0) {
      this.stack.push(tipEntry);
    } else {
      // Adopt authoritative tip id (may repair a stale id).
      this.stack.replaceTip(tipEntry);
    }

    const stackIds = this.stack.snapshot().map((e) => e.nodeId);
    this.cache.replaceWarm(result.warm, result.node, stackIds);

    // Warm hit already painted this tip; remounting would restart screen readers.
    // Still adopt a changed label (e.g. "Copying…" → "Copied") or a repaired id.
    if (!this.isAlreadyShowing(result.node)) {
      this.showPayload(result.node);
    } else {
      this.tipKind = result.node.kind ?? "text";
    }

    if (result.location !== undefined && result.location !== null) {
      this.setAddressBar(result.location);
    }
  }
}
