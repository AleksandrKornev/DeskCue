import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  reporter: process.env.DESKCUE_E2E_REQUIRE_EXECUTED
    ? [
        [process.env.CI ? "github" : "list"],
        ["../../scripts/test/require-executed-reporter.mjs"]
      ]
    : process.env.CI ? "github" : "list",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.DESKCUE_E2E_BASE_URL ?? "http://127.0.0.1:4100",
    trace: "retain-on-failure"
  },
  workers: 1,
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome"
      }
    },
    {
      name: "mobile",
      use: devices["Pixel 5"]
    }
  ]
});
