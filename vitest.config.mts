import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/global-setup.ts"],
    // The first run may download a paper and extract its text.
    hookTimeout: 120_000,
  },
});
