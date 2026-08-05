import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub project Pages: https://<user>.github.io/nowisee/
  // Dev server keeps "/" so local `npm run dev` stays at the site root.
  base: process.env.NODE_ENV === "production" ? "/nowisee/" : "/",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
