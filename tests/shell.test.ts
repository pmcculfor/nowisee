/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { startShell } from "../src/shell/bootstrap.ts";
import { createHomeApp } from "../src/apps/home/index.ts";
import { createAppHost } from "../server/host.ts";

describe("shell bootstrap", () => {
  it("opens Home at #/ with rootAppId home and lists Help first", async () => {
    window.location.hash = "#/";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const shell = startShell(mount, {
      config: { rootAppId: "home" },
      rpc: createAppHost({ rootAppId: "home" }),
    });
    await shell.navigator.openLocation({ appId: "home", path: "/" });

    expect(shell.registry.listDescriptors()).toEqual([{ id: "home", label: "home" }]);
    expect(mount.textContent).toContain("Help.");
    expect(shell.navigator.getCurrentAppId()).toBe("home");
    expect(mount.querySelectorAll("button[data-nav-pad]")).toHaveLength(4);
    expect(mount.querySelector('[data-shell="surface"]')).not.toBeNull();

    shell.stop();
  });

  it("opens a server app by id without a client phone book", async () => {
    window.location.hash = "#/bible";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const shell = startShell(mount, {
      config: { rootAppId: "home" },
      rpc: createAppHost({ rootAppId: "home" }),
    });
    await shell.navigator.openLocation({ appId: "bible", path: "/" });

    expect(shell.navigator.getCurrentAppId()).toBe("bible");
    expect(mount.textContent).toContain("Old Testament");
    expect(shell.registry.listDescriptors()).toEqual([{ id: "bible", label: "bible" }]);

    shell.stop();
  });

  it("Home has no registry handle; the directory is a ctx grant", () => {
    const home = createHomeApp();
    expect(home.id).toBe("home");
    expect(home).not.toHaveProperty("registry");
  });
});
