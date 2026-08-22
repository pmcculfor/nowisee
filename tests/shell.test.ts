/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { createHomeApp } from "../src/apps/home.ts";
import { startShell } from "../src/shell/bootstrap.ts";
import { createAppHost } from "../server/host.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

describe("shell bootstrap", () => {
  it("opens Home at #/ with rootAppId home and lists Bible", async () => {
    window.location.hash = "#/";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const shell = startShell(mount, {
      config: { rootAppId: "home" },
      rpc: createAppHost({ kjv: fixtureKjv, rootAppId: "home" }),
    });
    await shell.navigator.openLocation({ appId: "home", path: "/" });

    expect(shell.registry.listEnabled()).toEqual([
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
      { id: "account", label: "Account" },
    ]);
    expect(mount.textContent).toContain("Bible");
    expect(shell.navigator.getCurrentAppId()).toBe("home");
    expect(mount.querySelectorAll("button[data-nav-pad]")).toHaveLength(4);
    expect(mount.querySelector('[data-shell="surface"]')).not.toBeNull();

    shell.stop();
  });

  it("Home is constructed with listEnabled descriptors, not the registry object", () => {
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: () => [{ id: "home", label: "Home" }],
    });
    expect(home.id).toBe("home");
    expect(home).not.toHaveProperty("registry");
  });
});
