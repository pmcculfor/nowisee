import { createBibleApp } from "../apps/bible/index.ts";
import type { KjvData } from "../apps/bible/types.ts";
import kjvJson from "../apps/bible/data/kjv.json" with { type: "json" };
import { createHomeApp } from "../apps/home.ts";
import {
  createLocalNotesStore,
  createMemoryNotesStore,
  createNotesApp,
  type NotesStore,
} from "../apps/notes/index.ts";
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
  readonly kjv?: KjvData;
  /**
   * Injected Notes persistence. Defaults to a localStorage-backed store when
   * available; tests may pass a memory store. Swap for a remote adapter later.
   */
  readonly notesStore?: NotesStore;
};

/**
 * Bootstrap the shell. Core never names a product app — `rootAppId` comes from config.
 * Mail registers in a later slice.
 */
export function startShell(
  mount: HTMLElement,
  options: StartShellOptions = {},
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
  registry.register(
    createNotesApp({
      rootAppId: config.rootAppId,
      store: options.notesStore ?? defaultNotesStore(),
    }),
  );

  mount.replaceChildren();
  const surface = document.createElement("div");
  surface.dataset.shell = "surface";
  mount.appendChild(surface);

  const display = new Display(surface);
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
      navPads.detach();
      router.detach();
    },
  };
}

/** Browser-local MVP store. Shell owns the localStorage touch — not the app. */
function defaultNotesStore(): NotesStore {
  const storage = globalThis.localStorage;
  if (storage && typeof storage.getItem === "function") {
    return createLocalNotesStore({
      kv: {
        get: (key) => storage.getItem(key),
        set: (key, value) => {
          storage.setItem(key, value);
        },
      },
    });
  }
  // Non-browser hosts (or blocked storage): in-memory only for the session.
  return createMemoryNotesStore();
}
