import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@composeui/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@composeui/operation-log": new URL("./packages/operation-log/src/index.ts", import.meta.url)
        .pathname,
      "@composeui/editor": new URL("./packages/editor/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/playground/src/**/*.test.ts"],
  },
})
