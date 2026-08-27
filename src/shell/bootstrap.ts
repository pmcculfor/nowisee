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
import type { AppModule, NavIntent, ShellConfig } from "../core/types.ts";
import { attachNativeBridge, isNativeHostPresent } from "./nativeBridge.ts";

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
 * The client does not keep an app catalog: a generic stub POSTs using the app id
 * from the URL or a `kind: "app"` edge. Home lists apps from the server directory.
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

  function resolveApp(id: string): AppModule {
    const existing = registry.get(id);
    if (existing) {
      return existing;
    }
    const stub = createRemoteApp({ id, rpc });
    registry.register(stub);
    return stub;
  }

  mount.replaceChildren();
  const surface = document.createElement("div");
  surface.dataset.shell = "surface";
  mount.appendChild(surface);

  let navigator!: Navigator;
  let nativeNotify: (() => void) | undefined;
  const display = new Display(surface, {
    isBlocked: () => navigator.isBlocked(),
    onIntent: (intent: NavIntent) => {
      void navigator.onIntent(intent);
    },
    onSurfaceChange: () => {
      nativeNotify?.();
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
    resolveApp,
  });

  router = new Router({
    rootAppId: config.rootAppId,
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

  keyboard.attach();
  router.attach();

  let nativeDetach: (() => void) | undefined;
  let navPads: NavPads | undefined;
  if (isNativeHostPresent()) {
    const bridge = attachNativeBridge({
      onIntent: (intent) => navigator.onIntent(intent),
      getState: () => ({
        mode: display.getMode(),
        label: display.getLabel(),
        blocked: navigator.isBlocked(),
      }),
    });
    nativeNotify = () => {
      bridge.notify();
    };
    nativeDetach = () => {
      bridge.detach();
    };
  } else {
    navPads = new NavPads({
      parent: mount,
      host: intentHost,
    });
    navPads.attach();
  }

  const initial = router.parse(window.location.hash || "#/");
  // openLocation → showText/showInput already focuses. A second focus() here
  // restarts VoiceOver on iOS after the first utterance has begun.
  void navigator.openLocation(initial).finally(() => {
    nativeNotify?.();
  });

  return {
    navigator,
    router,
    registry,
    display,
    stop() {
      keyboard.detach();
      navPads?.detach();
      nativeDetach?.();
      router.detach();
    },
  };
}
