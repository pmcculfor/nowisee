/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { createHomeApp } from "../src/apps/home.ts";
import { startShell } from "../src/shell/bootstrap.ts";

describe("shell bootstrap", () => {
  it("opens Home at #/ with rootAppId home", async () => {
    window.location.hash = "#/";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const shell = startShell(mount, { config: { rootAppId: "home" } });
    await shell.navigator.openLocation({ appId: "home", path: "/" });

    expect(shell.registry.listEnabled()).toEqual([{ id: "home", label: "Home" }]);
    expect(mount.textContent).toContain("Home");
    expect(shell.navigator.getCurrentAppId()).toBe("home");

    shell.stop();
  });

  it("Home is constructed with listEnabled descriptors, not the registry object", () => {
    // Structural check: createHomeApp used by bootstrap only accepts listEnabled callback.
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: () => [{ id: "home", label: "Home" }],
    });
    expect(home.id).toBe("home");
    expect(home).not.toHaveProperty("registry");
  });
});
