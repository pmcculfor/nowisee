import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...listFiles(path));
    } else if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("packaging boundary", () => {
  it("core never imports app-kit", () => {
    const coreFiles = listFiles(join(process.cwd(), "src", "core"));
    const offenders: string[] = [];
    for (const file of coreFiles) {
      const text = readFileSync(file, "utf8");
      if (text.includes("app-kit") || text.includes("appKit")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("browser shell does not import Bible data, Notes, or in-page Home/Bible modules", () => {
    const bootstrap = readFileSync(join(process.cwd(), "src", "shell", "bootstrap.ts"), "utf8");
    expect(bootstrap).not.toContain("kjv.json");
    expect(bootstrap).not.toContain("apps/bible");
    expect(bootstrap).not.toContain("apps/notes");
    expect(bootstrap).not.toContain("apps/home");
  });

  it("remote stub does not import a specific app", () => {
    const remote = readFileSync(join(process.cwd(), "src", "apps", "remote.ts"), "utf8");
    expect(remote).not.toContain("bible");
    expect(remote).not.toContain("kjv");
  });
});
