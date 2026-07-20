import { defineConfig, devices } from "@playwright/test";

const serverPort = process.env.PLAYWRIGHT_PORT ?? "3000";
if (!/^[1-9][0-9]{0,4}$/.test(serverPort) || Number(serverPort) > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be a valid TCP port");
}
const serverUrl = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? serverUrl,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? undefined
    : {
        command: process.env.CI
          ? `npm run build && npm run start -- --hostname 127.0.0.1 --port ${serverPort}`
          : `npm run dev -- --hostname 127.0.0.1 --port ${serverPort}`,
        url: serverUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
