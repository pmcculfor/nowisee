import { createBibleApp } from "../apps/bible/index.ts";
import type { KjvData } from "../apps/bible/types.ts";
import kjvJson from "../apps/bible/data/kjv.json" with { type: "json" };
import { createHomeApp } from "../apps/home.ts";
import { Display } from "../core/display.ts";
import { defaultKeyBindings, Keyboard } from "../core/keyboard.ts";
import { NavigationMapStore } from "../core/navigationMap.ts";
import { Navigator } from "../core/navigator.ts";
import { NodeCache } from "../core/nodeCache.ts";
import { PlatformCapabilities } from "../core/platform.ts";
import { AppRegistry } from "../core/registry.ts";
import { Router } from "../core/router.ts";
import { Stack } from "../core/stack.ts";
import type { ShellConfig } from "../core/types.ts";

export type ShellHandle = {
  readonly navigator: Navigator;
  readonly router: Router;
  readonly registry: AppRegistry;
  readonly display: Display;
  stop(): void;
};

/**
 * Bootstrap the shell. Core never names a product app — `rootAppId` comes from config.
 * Mail registers in a later slice.
 */
export function startShell(
  mount: HTMLElement,
  options: { readonly config?: ShellConfig; readonly kjv?: KjvData } = {},
): ShellHandle {
  const config: ShellConfig = {
    rootAppId: options.config?.rootAppId ?? "home",
    keyBindings: options.config?.keyBindings,
  };

  const registry = new AppRegistry();
  const home = createHomeApp({
    listEnabled: () => registry.listEnabled(),
    rootAppId: config.rootAppId,
  });
  registry.register(home);
  registry.register(
    createBibleApp({
      rootAppId: config.rootAppId,
      data: options.kjv ?? (kjvJson as KjvData),
    }),
  );

  const display = new Display(mount);
  const map = new NavigationMapStore();
  const cache = new NodeCache();
  const stack = new Stack();
  const platform = new PlatformCapabilities();

  let router!: Router;
  const navigator = new Navigator({
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

  const keyboard = new Keyboard({
    target: window,
    host: {
      getTipKind: () => navigator.getTipKind(),
      isBlocked: () => navigator.isBlocked(),
      onIntent: (intent) => {
        void navigator.onIntent(intent);
      },
    },
    bindings: config.keyBindings ?? defaultKeyBindings(),
  });

  keyboard.attach();
  router.attach();

  const initial =
    router.parse(window.location.hash || "#/") ?? {
      appId: config.rootAppId,
      path: "/",
    };
  void navigator.openLocation(initial).then(() => {
    display.focus();
  });

  return {
    navigator,
    router,
    registry,
    display,
    stop() {
      keyboard.detach();
      router.detach();
    },
  };
}
