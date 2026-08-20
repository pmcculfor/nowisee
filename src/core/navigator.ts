import type { Display } from "./display.ts";
import type { NavigationMapStore } from "./navigationMap.ts";
import type { NodeCache } from "./nodeCache.ts";
import type { PlatformCapabilities } from "./platform.ts";
import type { AppRegistry } from "./registry.ts";
import { isCanonicalPath } from "./router.ts";
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

type ApplyAs = { kind: "open"; appId: string } | { kind: "refresh" };

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
   * restart mid-utterance). Cleared when a successful open applies, because
   * the new app's tip must remount even if ids happened to collide.
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

    if (!isWellFormedEdge(edge)) {
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

    this.transitionToken += 1;
    const token = this.transitionToken;
    this.supersedeInFlight();

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
    let appId = location.appId;
    let path = location.path;
    let app = this.registry.get(appId);
    if (!app) {
      appId = this.config.rootAppId;
      app = this.registry.get(appId);
      path = "/";
    }
    if (!app) {
      return;
    }
    if (!isCanonicalPath(path)) {
      return;
    }

    this.transitionToken += 1;
    const token = this.transitionToken;
    this.supersedeInFlight();
    this.blocked = true;

    await this.startCall({
      token,
      isAction: extras.action === true,
      invoke: (callExtras) => app.open(path, callExtras),
      baseExtras: extras,
      applyAs: { kind: "open", appId },
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
      if (this.stack.length <= 1) {
        return this.openLocation({ appId: this.config.rootAppId, path: "/" });
      }
      this.stack.pop();
      destId = this.stack.tip()!.nodeId;
    } else {
      destId = edge.toNodeId!;
    }

    const payload = this.cache.get(destId);
    if (payload) {
      this.applyLocalMove(behavior, payload, { updateDisplay: true });
      return this.startCall({
        token,
        isAction: extras.action === true,
        invoke: (callExtras) => this.currentApp()!.refresh(this.stack.snapshot(), callExtras),
        baseExtras: extras,
        applyAs: { kind: "refresh" },
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
      applyAs: { kind: "refresh" },
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

  private supersedeInFlight(): void {
    const prev = this.inFlight;
    if (!prev) {
      return;
    }
    // Action calls are never aborted — only their results are discarded.
    if (!prev.isAction) {
      prev.controller.abort();
    }
  }

  private async startCall(args: {
    token: number;
    isAction: boolean;
    baseExtras: RefreshExtras;
    applyAs: ApplyAs;
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
      this.applyResult(result, args.applyAs);
      this.blocked = false;
    } catch (err) {
      if (args.token !== this.transitionToken) {
        return;
      }
      // Keep display, stack, map, and cache as last good.
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

  private applyResult(result: RefreshResult, applyAs: ApplyAs): void {
    if (applyAs.kind === "open") {
      this.stack.clear();
      this.cache.clear();
      this.map.replace({});
      this.displayed = null;
      this.currentAppId = applyAs.appId;
    }

    this.map.replace(result.navigationMap);

    const priorLocation = this.stack.tip()?.location ?? null;
    const location =
      result.location === null
        ? priorLocation
        : isCanonicalPath(result.location.path)
          ? result.location
          : priorLocation;

    const tipEntry: StackEntry = {
      nodeId: result.node.id,
      label: result.node.label,
      location,
    };

    if (this.stack.length === 0) {
      this.stack.push(tipEntry);
    } else {
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

    if (result.location !== null && isCanonicalPath(result.location.path)) {
      this.setAddressBar(result.location);
    }
  }
}

function isWellFormedEdge(edge: NavEdge): boolean {
  if (edge.kind === "node") {
    return edge.stackBehavior === "pop" || Boolean(edge.toNodeId);
  }
  if (edge.kind === "app") {
    return Boolean(edge.to.appId) && isCanonicalPath(edge.to.path);
  }
  return edge.href.length > 0;
}
