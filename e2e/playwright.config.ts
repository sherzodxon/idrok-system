import { defineConfig, devices } from "@playwright/test";
import { WEB_URL } from "./support/users";

// Run `pnpm --filter @idrok/web build` first: the stack serves the production build.
export default defineConfig({
  testDir: "tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "uz-UZ",
    timezoneId: "Asia/Tashkent",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
