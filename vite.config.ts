import { defineConfig } from "vitest/config";
import { nowiseeApiPlugin } from "./server/vitePlugin.ts";

export default defineConfig({
  plugins: [nowiseeApiPlugin()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
