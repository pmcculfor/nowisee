import type { Display } from "./display.ts";
import type { NavigationMapStore } from "./navigationMap.ts";
import type { NodeCache } from "./nodeCache.ts";
import type { PlatformCapabilities } from "./platform.ts";
import type { AppRegistry } from "./registry.ts";
import { isCanonicalPath } from "./router.ts";
import { isRefreshResult } from "./refreshResult.ts";
import { SessionPark, type ParkedSession } from "./sessionPark.ts";
import type { Stack } from "./stack.ts";
import type {
  AppLocation,
  AppModule,
  NavEdge,
  NavIntent,
  NodeKind,
  NodePayload,
  OpenResult,
  RefreshExtras,
  RefreshResult,
  ShellConfig,
  StackBehavior,
  StackEntry,
} from "./types.ts";
import { isActionExtras } from "./types.ts";

export interface NavigatorOptions {
  readonly config: ShellConfig;
  readonly registry: AppRegistry;
  readonly display: Display;
  readonly platform: PlatformCapabilities;
  readonly map: NavigationMapStore;
  readonly cache: NodeCache;
  readonly stack: Stack;
  /** Address-bar writes go through Router.setAddressBar — never mint pathnames here. */
  readonly setAddressBar: (location: AppLocation) => void;
  /**
   * Supply an AppModule when the registry has no entry for this id.
   * Bootstrap uses this to mint a generic RPC stub; the server is the catalog.
   * When omitted, a missing id still falls back to `config.rootAppId`.
   */
  readonly resolveApp?: (appId: string) => AppModule | null;
  /** `kind: "external"` hand-off. Injected for tests. */
  readonly handOffExternal?: (href: string) => void;
}

type InFlight = {
  token: number;
  controller: AbortController;
  isAction: boolean;
};

type ApplyAs = { kind: "open"; appId: string } | { kind: "refresh" };

type CallArgs = {
  token: number;
  isAction: boolean;
  baseExtras: RefreshExtras;
  applyAs: ApplyAs;
  invoke: (extras: RefreshExtras) => Promise<RefreshResult> | RefreshResult;
  enterRecoveryOnFailure?: LoadRecovery;
};

type LoadRecovery = {
  readonly kind: "load" | "action";
  readonly stackBefore: readonly StackEntry[];
  readonly previous: NodePayload | null;
};

/** Spoken on a warm-miss refresh failure. Core recovery copy, not an app node. */
export const LOAD_FAILURE_LABEL =
  "Something went wrong. Please check your network connection. Navigate right to try again. Navigate left to go back.";

/** Spoken on an action-call failure. Enter must not re-issue the action. */
export const ACTION_FAILURE_LABEL =
  "Something went wrong. Please check your network connection. Navigate left to go back.";

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
  private readonly resolveApp: ((appId: string) => AppModule | null) | undefined;
  private readonly handOffExternal: (href: string) => void;

  private blocked = false;
  private transitionToken = 0;
  private inFlight: InFlight | null = null;
  /** Latest read-only refresh waiting for `inFlight` to settle. Overwritten, never queued. */
  private pending: CallArgs | null = null;
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
  private loadRecovery: LoadRecovery | null = null;
  private readonly park = new SessionPark();
  /** Snapshot to `put` after a successful cross-app `open`. */
  private pendingPark: ParkedSession | null = null;

  constructor(options: NavigatorOptions) {
    this.config = options.config;
    this.registry = options.registry;
    this.display = options.display;
    this.platform = options.platform;
    this.map = options.map;
    this.cache = options.cache;
    this.stack = options.stack;
    this.setAddressBar = options.setAddressBar;
    this.resolveApp = options.resolveApp;
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
    if (this.loadRecovery) {
      return this.onLoadRecoveryIntent(intent);
    }
    if (intent === "recents") {
      const recentsAppId = this.config.recentsAppId;
      if (recentsAppId && this.currentAppId !== recentsAppId) {
        return this.openLocation({ appId: recentsAppId, path: "/" });
      }
    }
    const tip = this.stack.tip();
    if (!tip) {
      return;
    }

    const edge = this.map.lookup(tip.nodeId, intent);
    if (!edge) {
      return;
    }

    if (!isWellFormedEdge(edge, tip.nodeId, tip.frame)) {
      console.warn("Navigator: malformed edge", tip.nodeId, intent);
      return;
    }

    const extras: RefreshExtras = {};
    const tipPayload = this.cache.get(tip.nodeId);
    const kind = tipPayload?.kind ?? this.tipKind;
    if (edge.kind !== "external" && edge.kind !== "resume" && edge.passInputText && kind === "input") {
      extras.inputText = this.display.getInputText();
    }
    if (edge.kind !== "external" && edge.kind !== "resume" && edge.action) {
      extras.action = { triggerId: tip.nodeId };
    }

    this.transitionToken += 1;
    const token = this.transitionToken;

    if (edge.kind === "external") {
      this.preemptReadOnly();
      this.handOffExternal(edge.href);
      return;
    }

    if (edge.kind === "resume") {
      return this.resumeApp(edge.appId);
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
    let app = this.registry.get(appId) ?? this.resolveApp?.(appId) ?? null;
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

    this.pendingPark =
      this.currentAppId && this.currentAppId !== appId ? this.snapshotCurrent() : null;

    this.transitionToken += 1;
    const token = this.transitionToken;
    this.preemptReadOnly();
    this.blocked = true;

    await this.startCall({
      token,
      isAction: isActionExtras(extras),
      invoke: (callExtras) => app.open(path, callExtras),
      baseExtras: extras,
      applyAs: { kind: "open", appId },
    });
  }

  private resumeApp(appId: string): void | Promise<void> {
    const parked = this.park.peek(appId);
    if (!parked || parked.stack.length === 0) {
      return this.openLocation({ appId, path: "/" });
    }
    const outgoing = this.snapshotCurrent();
    if (outgoing && outgoing.appId !== appId) {
      this.park.put(outgoing);
    }
    this.park.drop(appId);

    const dest = this.registry.get(appId) ?? this.resolveApp?.(appId) ?? null;
    if (!dest) {
      return this.openLocation({ appId: this.config.rootAppId, path: "/" });
    }

    this.transitionToken += 1;
    const token = this.transitionToken;
    this.preemptReadOnly();

    this.currentAppId = appId;
    this.stack.restore(parked.stack);
    this.cache.clear();
    this.map.replace({});
    this.displayed = null;
    this.paintParked(parked);
    this.blocked = true;

    const stackBefore = parked.stack;
    const previous = this.payloadForParked(parked);
    const tipId = this.stack.tip()!.nodeId;
    return this.startCall({
      token,
      isAction: false,
      invoke: (callExtras) => dest.refresh(tipId, callExtras),
      baseExtras: {},
      applyAs: { kind: "refresh" },
      enterRecoveryOnFailure: { kind: "load", stackBefore, previous },
    });
  }

  private followNodeEdge(
    edge: Extract<NavEdge, { kind: "node" }>,
    extras: RefreshExtras,
    token: number,
  ): Promise<void> | void {
    const behavior: StackBehavior = edge.stackBehavior;
    const stackBefore = this.stack.snapshot();
    const previous = this.payloadForCurrentTip();
    const isAction = isActionExtras(extras);
    const recovery: LoadRecovery = {
      kind: isAction ? "action" : "load",
      stackBefore,
      previous,
    };

    if (behavior === "pop") {
      if (this.stack.length <= 1) {
        return this.openLocation({ appId: this.config.rootAppId, path: "/" });
      }
      this.stack.pop();
    } else if (behavior === "popTransient") {
      const frame = this.stack.tip()?.frame;
      if (!frame) {
        return;
      }
      const snapshot = this.stack.snapshot();
      let keep = snapshot.length - 1;
      while (keep >= 0 && snapshot[keep]?.frame === frame) {
        keep--;
      }
      if (keep < 0) {
        return this.openLocation({ appId: this.config.rootAppId, path: "/" });
      }
      while (this.stack.length > keep + 1) {
        this.stack.pop();
      }
    }

    const destId =
      behavior === "stay" || behavior === "pop" || behavior === "popTransient"
        ? this.stack.tip()!.nodeId
        : edge.toNodeId!;

    const payload = this.cache.get(destId);
    if (isAction) {
      this.blocked = true;
    }

    if (payload) {
      this.applyLocalMove(behavior, payload, {
        updateDisplay: behavior !== "stay",
        frame: edge.frame,
      });
      return this.scheduleCall(this.refreshCall(token, extras, isAction ? recovery : undefined));
    }

    this.blocked = true;
    this.applyLocalMove(
      behavior,
      { id: destId, label: "" },
      { updateDisplay: false, frame: edge.frame },
    );
    return this.scheduleCall(this.refreshCall(token, extras, recovery));
  }

  private onLoadRecoveryIntent(intent: NavIntent): void | Promise<void> {
    const recovery = this.loadRecovery;
    if (!recovery) {
      return;
    }
    if (intent === "enter") {
      if (recovery.kind === "action") {
        return;
      }
      const app = this.currentApp();
      if (!app) {
        return;
      }
      this.transitionToken += 1;
      const token = this.transitionToken;
      this.preemptReadOnly();
      this.blocked = true;
      return this.startCall(this.refreshCall(token, {}, recovery));
    }
    if (intent === "back") {
      this.exitLoadRecovery();
    }
  }

  private enterLoadRecovery(recovery: LoadRecovery): void {
    this.loadRecovery = recovery;
    this.tipKind = "text";
    const label = recovery.kind === "action" ? ACTION_FAILURE_LABEL : LOAD_FAILURE_LABEL;
    this.display.showText(label);
    if (this.currentAppId) {
      this.displayed = {
        appId: this.currentAppId,
        id: this.stack.tip()?.nodeId ?? "",
        kind: "text",
        label,
      };
    }
  }

  private exitLoadRecovery(): void {
    const recovery = this.loadRecovery;
    if (!recovery) {
      return;
    }
    this.loadRecovery = null;
    this.stack.restore(recovery.stackBefore);
    const payload = recovery.previous ?? this.payloadForCurrentTip();
    if (payload) {
      this.showPayload(payload);
    }
  }

  private payloadForCurrentTip(): NodePayload | null {
    const tip = this.stack.tip();
    if (!tip) {
      return null;
    }
    const cached = this.cache.get(tip.nodeId);
    if (cached) {
      return cached;
    }
    if (this.displayed && this.displayed.appId === this.currentAppId) {
      return {
        id: this.displayed.id,
        label: this.displayed.label,
        kind: this.displayed.kind,
      };
    }
    return { id: tip.nodeId, label: tip.label };
  }

  private applyLocalMove(
    behavior: StackBehavior,
    payload: NodePayload,
    opts: { updateDisplay: boolean; frame?: string },
  ): void {
    if (behavior === "stay") {
      if (opts.updateDisplay) {
        this.showPayload(payload);
      }
      return;
    }

    const existing = this.stack.tip();
    if (behavior === "push") {
      this.stack.push(this.entryFromPayload(payload));
    } else if (behavior === "pushTransient") {
      this.stack.push(this.entryFromPayload(payload, opts.frame ?? existing?.frame));
    } else if (behavior === "replace") {
      this.stack.replaceTip(this.entryFromPayload(payload, existing?.frame, existing?.location));
    } else {
      this.stack.replaceTip(
        this.entryFromPayload(payload, existing?.frame, existing?.location ?? null),
      );
    }

    if (opts.updateDisplay) {
      this.showPayload(payload);
    }
  }

  private entryFromPayload(
    payload: NodePayload,
    frame?: string,
    location: AppLocation | null = null,
  ): StackEntry {
    const entry: StackEntry = {
      nodeId: payload.id,
      label: payload.label,
      location,
    };
    if (frame) {
      entry.frame = frame;
    }
    return entry;
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
      this.display.showInput(payload.label, {
        secret: payload.secret,
        autocomplete: payload.autocomplete,
      });
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

  private refreshCall(
    token: number,
    extras: RefreshExtras,
    enterRecoveryOnFailure?: LoadRecovery,
  ): CallArgs {
    const tipId = this.stack.tip()?.nodeId ?? "";
    const app = this.currentApp();
    return {
      token,
      isAction: isActionExtras(extras),
      invoke: (callExtras) => app!.refresh(tipId, callExtras),
      baseExtras: extras,
      applyAs: { kind: "refresh" },
      enterRecoveryOnFailure,
    };
  }

  /**
   * Drop a queued read-only refresh and abort an in-flight read-only call.
   * Actions are left running.
   */
  private preemptReadOnly(): void {
    this.pending = null;
    if (this.inFlight && !this.inFlight.isAction) {
      this.inFlight.controller.abort();
    }
  }

  /** One in-flight read-only refresh; further read-only intents overwrite `pending`. */
  private scheduleCall(args: CallArgs): Promise<void> | void {
    if (args.isAction) {
      this.preemptReadOnly();
      this.blocked = true;
      return this.startCall(args);
    }
    if (!this.inFlight) {
      return this.startCall(args);
    }
    this.pending = args;
  }

  private flushPending(): void {
    const next = this.pending;
    if (!next) {
      return;
    }
    this.pending = null;
    void this.startCall(next);
  }

  private resultCoversCurrentTip(result: RefreshResult): boolean {
    const tipId = this.stack.tip()?.nodeId;
    if (!tipId) {
      return false;
    }
    if (result.node.id === tipId) {
      return true;
    }
    return result.warm.some((payload) => payload.id === tipId);
  }

  /**
   * Stale read-only result whose warm set still contains the live tip.
   * Replaces map and warm; does not adopt `result.node` as the stack tip.
   */
  private applyCovering(result: RefreshResult): void {
    this.map.replace(result.navigationMap);
    const stackIds = this.stack.snapshot().map((e) => e.nodeId);
    this.cache.replaceWarm(result.warm, result.node, stackIds);
    const tip = this.stack.tip();
    const current = tip ? this.cache.get(tip.nodeId) : undefined;
    if (!current) {
      return;
    }
    if (!this.isAlreadyShowing(current)) {
      this.showPayload(current);
    }
    this.blocked = false;
  }

  private async startCall(args: CallArgs): Promise<void> {
    const controller = new AbortController();
    this.inFlight = {
      token: args.token,
      controller,
      isAction: args.isAction,
    };

    if (args.isAction) {
      this.blocked = true;
      this.platform.beginClipboardWrite();
    }

    const callExtras: RefreshExtras = {
      ...args.baseExtras,
      signal: controller.signal,
    };
    if (args.isAction && args.baseExtras.action) {
      callExtras.action = args.baseExtras.action;
    } else {
      delete callExtras.action;
    }
    if (this.shouldSendParkedIds(args.applyAs)) {
      callExtras.parkedAppIds = this.parkedAppIdsForRecents();
    } else {
      delete callExtras.parkedAppIds;
    }

    try {
      const result = await args.invoke(callExtras);
      if (!isRefreshResult(result)) {
        throw new Error("Navigator: malformed RefreshResult");
      }
      const settled = await this.fulfillClipboardText(result, args.isAction);
      if (args.token === this.transitionToken) {
        this.applyResult(settled, args.applyAs);
        this.pendingPark = null;
        this.blocked = false;
      } else if (
        !args.isAction &&
        args.applyAs.kind === "refresh" &&
        this.resultCoversCurrentTip(settled)
      ) {
        this.applyCovering(settled);
      }
    } catch (err) {
      if (args.token !== this.transitionToken) {
        return;
      }
      console.warn("Navigator: refresh/open failed", err);
      if (args.enterRecoveryOnFailure) {
        this.enterLoadRecovery(args.enterRecoveryOnFailure);
      }
      this.pendingPark = null;
      this.blocked = false;
    } finally {
      if (args.isAction) {
        this.platform.endClipboardWrite();
      }
      if (this.inFlight?.token === args.token) {
        this.inFlight = null;
        this.flushPending();
      }
    }
  }

  /**
   * Apps return `clipboardText`; core writes the device clipboard.
   * Runs even if this result is later discarded, so Copy still happens.
   */
  private async fulfillClipboardText(
    result: RefreshResult,
    isAction: boolean,
  ): Promise<RefreshResult> {
    const text = result.clipboardText;
    if (!isAction || text === undefined || text.length === 0) {
      return result;
    }
    const clipboard = this.platform.createContext().clipboard;
    if (!clipboard) {
      return withStatusLabel(result, "Copy failed: clipboard unavailable.");
    }
    try {
      await clipboard.writeText(text);
      return result;
    } catch {
      return withStatusLabel(result, "Copy failed.");
    }
  }

  private applyResult(result: RefreshResult, applyAs: ApplyAs): void {
    this.loadRecovery = null;
    if (applyAs.kind === "open") {
      if (this.pendingPark && this.pendingPark.appId !== applyAs.appId) {
        this.park.put(this.pendingPark);
      }
      this.park.drop(applyAs.appId);
      this.pendingPark = null;
      this.stack.clear();
      this.cache.clear();
      this.map.replace({});
      this.displayed = null;
      this.currentAppId = applyAs.appId;
      const ancestry = openAncestry(result as OpenResult, result.node.id);
      if (ancestry) {
        this.stack.restore(ancestry);
      }
    }

    this.map.replace(result.navigationMap);

    const priorLocation = this.stack.tip()?.location ?? null;
    const existingFrame = this.stack.tip()?.frame;
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
      ...(applyAs.kind === "open" ? {} : existingFrame ? { frame: existingFrame } : {}),
    };

    if (this.stack.length === 0) {
      this.stack.push(tipEntry);
    } else {
      this.stack.replaceTip(tipEntry);
    }

    const stackIds = this.stack.snapshot().map((e) => e.nodeId);
    this.cache.replaceWarm(result.warm, result.node, stackIds);

    if (!this.isAlreadyShowing(result.node)) {
      this.showPayload(result.node);
    } else {
      this.tipKind = result.node.kind ?? "text";
    }

    if (result.location !== null && isCanonicalPath(result.location.path)) {
      this.setAddressBar(result.location);
    }
  }

  private shouldSendParkedIds(applyAs: ApplyAs): boolean {
    const recentsAppId = this.config.recentsAppId;
    if (!recentsAppId) {
      return false;
    }
    if (applyAs.kind === "open") {
      return applyAs.appId === recentsAppId;
    }
    return this.currentAppId === recentsAppId;
  }

  private parkedAppIdsForRecents(): readonly string[] {
    const ids = this.park.list();
    const pending = this.pendingPark;
    if (!pending) {
      return ids;
    }
    return [pending.appId, ...ids.filter((id) => id !== pending.appId)];
  }

  private snapshotCurrent(): ParkedSession | null {
    if (!this.currentAppId || this.stack.length === 0) {
      return null;
    }
    const tip = this.stack.tip();
    const payload = tip ? this.cache.get(tip.nodeId) : null;
    const session: ParkedSession = {
      appId: this.currentAppId,
      stack: this.stack.snapshot(),
      tipKind: this.tipKind,
    };
    if (this.tipKind === "input") {
      return {
        ...session,
        inputText: this.display.getInputText(),
        secret: payload?.secret,
        autocomplete: payload?.autocomplete,
      };
    }
    return session;
  }

  private paintParked(session: ParkedSession): void {
    const tip = session.stack[session.stack.length - 1];
    if (!tip) {
      return;
    }
    this.tipKind = session.tipKind;
    this.displayed = {
      appId: session.appId,
      id: tip.nodeId,
      kind: session.tipKind,
      label: tip.label,
    };
    if (session.tipKind === "input") {
      this.display.showInput(session.inputText ?? tip.label, {
        secret: session.secret,
        autocomplete: session.autocomplete,
      });
    } else {
      this.display.showText(tip.label);
    }
    const location = locationFromStack(session.stack);
    if (location) {
      this.setAddressBar(location);
    }
  }

  private payloadForParked(session: ParkedSession): NodePayload | null {
    const tip = session.stack[session.stack.length - 1];
    if (!tip) {
      return null;
    }
    return {
      id: tip.nodeId,
      label: tip.label,
      kind: session.tipKind,
      secret: session.secret,
      autocomplete: session.autocomplete,
    };
  }
}

function withStatusLabel(result: RefreshResult, label: string): RefreshResult {
  return {
    ...result,
    clipboardText: undefined,
    node: { ...result.node, label },
  };
}

function isWellFormedEdge(edge: NavEdge, fromNodeId: string, tipFrame?: string): boolean {
  if (edge.kind === "node") {
    const behavior = edge.stackBehavior;
    if (behavior === "pop" || behavior === "stay") {
      return !edge.toNodeId;
    }
    if (behavior === "popTransient") {
      return !edge.toNodeId && Boolean(tipFrame);
    }
    if (behavior === "pushTransient") {
      return Boolean(edge.toNodeId) && typeof edge.frame === "string" && edge.frame.length > 0;
    }
    if (behavior === "replace" && edge.toNodeId === fromNodeId) {
      return false;
    }
    if (behavior === "push" || behavior === "replace") {
      return Boolean(edge.toNodeId);
    }
    return false;
  }
  if (edge.kind === "app") {
    return Boolean(edge.to.appId) && isCanonicalPath(edge.to.path);
  }
  if (edge.kind === "resume") {
    return edge.appId.length > 0;
  }
  return edge.href.length > 0;
}

function openAncestry(result: OpenResult, tipId: string): StackEntry[] | null {
  const raw = result.stack;
  if (!raw || raw.length === 0) {
    return null;
  }
  const last = raw[raw.length - 1];
  if (!last || last.nodeId !== tipId) {
    console.warn("Navigator: discarded open ancestry (last entry must be the tip)");
    return null;
  }
  const out: StackEntry[] = [];
  for (const entry of raw) {
    if (typeof entry.nodeId !== "string" || entry.nodeId.length === 0) {
      console.warn("Navigator: discarded open ancestry (invalid entry)");
      return null;
    }
    if (typeof entry.label !== "string") {
      console.warn("Navigator: discarded open ancestry (invalid entry)");
      return null;
    }
    let location: AppLocation | null = null;
    if (entry.location !== null && entry.location !== undefined) {
      if (!entry.location.appId || !isCanonicalPath(entry.location.path)) {
        console.warn("Navigator: discarded open ancestry (non-canonical location)");
        return null;
      }
      location = { appId: entry.location.appId, path: entry.location.path };
    }
    out.push({ nodeId: entry.nodeId, label: entry.label, location });
  }
  return out;
}

function locationFromStack(stack: readonly StackEntry[]): AppLocation | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const location = stack[i]?.location;
    if (location) {
      return location;
    }
  }
  return null;
}
