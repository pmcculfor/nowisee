import type { AppDescriptor, AppModule } from "./types.ts";

/**
 * Registers AppModule instances at bootstrap.
 * `get` is core-internal only — never hand the registry (or a module) to an app.
 * Home reads descriptors through `ctx.directory`, not this object.
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
