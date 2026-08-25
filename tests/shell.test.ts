/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { HELP_APP_LABEL } from "../src/apps/help/ids.ts";
import { createHomeApp } from "../src/apps/home.ts";
import { startShell } from "../src/shell/bootstrap.ts";
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

    expect(shell.registry.listDescriptors()).toEqual([
      { id: "home", label: "Home" },
      { id: "help", label: HELP_APP_LABEL },
      { id: "bible", label: "Bible" },
      { id: "notes", label: "Notes" },
      { id: "gmail", label: "Gmail" },
      { id: "account", label: "Account" },
    ]);
    expect(mount.textContent).toContain("Help.");
    expect(shell.navigator.getCurrentAppId()).toBe("home");
    expect(mount.querySelectorAll("button[data-nav-pad]")).toHaveLength(4);
    expect(mount.querySelector('[data-shell="surface"]')).not.toBeNull();

    shell.stop();
  });

  it("Home has no registry handle; the directory is a ctx grant", () => {
    const home = createHomeApp({
      rootAppId: "home",
    });
    expect(home.id).toBe("home");
    expect(home).not.toHaveProperty("registry");
  });
});
