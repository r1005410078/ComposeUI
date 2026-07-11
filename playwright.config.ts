import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "bun run --cwd apps/playground preview:e2e",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
})
