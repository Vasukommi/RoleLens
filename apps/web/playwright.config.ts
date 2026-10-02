import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3010", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run python tests/browser_server.py",
      cwd: "../api",
      url: "http://127.0.0.1:8010/api/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 3010",
      url: "http://127.0.0.1:3010",
      env: {
        API_BASE_URL: "http://127.0.0.1:8010",
        WORKSPACE_API_KEY: "synthetic-browser-workspace-token",
      },
      reuseExistingServer: false,
    },
  ],
});
