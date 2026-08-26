import type { AppDescriptor, AppModule } from "./types.ts";

/**
 * Holds AppModule instances for the current process.
 * Client: lazy RPC stubs keyed by app id (not a product catalog).
 * Host: real modules from the pack list; Home reads descriptors through `ctx.directory`.
 * `get` is core-internal only — never hand the registry (or a module) to an app.
 */
export class AppRegistry {
  private readonly modules = new Map<string, AppModule>();

  register(app: AppModule): void {
    if (this.modules.has(app.id)) {
      throw new Error(`AppRegistry: duplicate app id "${app.id}"`);
    }
    this.modules.set(app.id, app);
  }

  get(id: string): AppModule | null {
    return this.modules.get(id) ?? null;
  }

  listDescriptors(): AppDescriptor[] {
    return [...this.modules.values()].map((app) => ({
      id: app.id,
      label: app.label,
    }));
  }
}
