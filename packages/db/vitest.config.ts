import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Tests share one database; files run one after another.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
