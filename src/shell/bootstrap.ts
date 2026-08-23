import { HELP_APP_ID, HELP_APP_LABEL } from "../apps/help/ids.ts";
import { createRemoteApp } from "../apps/remote.ts";
import { createFetchRpc, type AppRpc } from "../apps/rpc.ts";
import { Display } from "../core/display.ts";
import { defaultKeyBindings, Keyboard } from "../core/keyboard.ts";
import { NavPads } from "../core/navPads.ts";
import { NavigationMapStore } from "../core/navigationMap.ts";
import { Navigator } from "../core/navigator.ts";
import { NodeCache } from "../core/nodeCache.ts";
import { PlatformCapabilities } from "../core/platform.ts";
import { AppRegistry } from "../core/registry.ts";
import { Router } from "../core/router.ts";
import { Stack } from "../core/stack.ts";
import type { NavIntent, ShellConfig } from "../core/types.ts";

export type ShellHandle = {
  readonly navigator: Navigator;
  readonly router: Router;
  readonly registry: AppRegistry;
  readonly display: Display;
  stop(): void;
};

export type StartShellOptions = {
  readonly config?: ShellConfig;
  /**
   * How the client talks to apps. Defaults to POST /api/apps/:id/…
   * Tests inject the in-process app host.
   */
  readonly rpc?: AppRpc;
};

/**
 * Bootstrap the shell. Core never names a product app — `rootAppId` comes from config.
 * Home, Help, Bible, Notes, and Account are remote stubs.
 */
export function startShell(
  mount: HTMLElement,
  options: StartShellOptions = {},
): ShellHandle {
  const config: ShellConfig = {
    rootAppId: options.config?.rootAppId ?? "home",
    keyBindings: options.config?.keyBindings,
  };

  const rpc = options.rpc ?? createFetchRpc();
  const registry = new AppRegistry();
  registry.register(createRemoteApp({ id: "home", label: "Home", rpc }));
  registry.register(createRemoteApp({ id: HELP_APP_ID, label: HELP_APP_LABEL, rpc }));
  registry.register(createRemoteApp({ id: "bible", label: "Bible", rpc }));
  registry.register(createRemoteApp({ id: "notes", label: "Notes", rpc }));
  registry.register(createRemoteApp({ id: "account", label: "Account", rpc }));

  mount.replaceChildren();
  const surface = document.createElement("div");
  surface.dataset.shell = "surface";
  mount.appendChild(surface);

  let navigator!: Navigator;
  const display = new Display(surface, {
    isBlocked: () => navigator.isBlocked(),
    onIntent: (intent: NavIntent) => {
      void navigator.onIntent(intent);
    },
  });
  const map = new NavigationMapStore();
  const cache = new NodeCache();
  const stack = new Stack();
  const platform = new PlatformCapabilities();

  let router!: Router;
  navigator = new Navigator({
    config,
    registry,
    display,
    platform,
    map,
    cache,
    stack,
    setAddressBar: (location) => {
      router.setAddressBar(location);
    },
  });

  router = new Router({
    rootAppId: config.rootAppId,
    isKnownApp: (id) => registry.get(id) !== null,
    onLocation: (location) => {
      void navigator.openLocation(location);
    },
  });

  const intentHost = {
    isBlocked: () => navigator.isBlocked(),
    onIntent: (intent: NavIntent) => {
      void navigator.onIntent(intent);
    },
  };

  const keyboard = new Keyboard({
    target: window,
    host: {
      getTipKind: () => navigator.getTipKind(),
      ...intentHost,
    },
    bindings: config.keyBindings ?? defaultKeyBindings(),
  });

  const navPads = new NavPads({
    parent: mount,
    host: intentHost,
  });

  keyboard.attach();
  navPads.attach();
  router.attach();

  const initial = router.parse(window.location.hash || "#/");
  // openLocation → showText/showInput already focuses. A second focus() here
  // restarts VoiceOver on iOS after the first utterance has begun.
  void navigator.openLocation(initial);

  return {
    navigator,
    router,
    registry,
    display,
    stop() {
      keyboard.detach();
      navPads.detach();
      router.detach();
    },
  };
}
