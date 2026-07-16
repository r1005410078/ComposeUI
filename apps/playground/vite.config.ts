import { defineConfig } from "vite"
import { fileURLToPath, URL } from "node:url"

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@composeui/editor/editor.css",
        replacement: fromRoot("../../packages/editor/src/editor.css"),
      },
      {
        find: "@composeui/editor/theme.css",
        replacement: fromRoot("../../packages/editor/src/theme.css"),
      },
      {
        find: "@composeui/editor",
        replacement: fromRoot("../../packages/editor/src/index.ts"),
      },
      {
        find: "@composeui/core",
        replacement: fromRoot("../../packages/core/src/index.ts"),
      },
      {
        find: "@composeui/operation-log",
        replacement: fromRoot("../../packages/operation-log/src/index.ts"),
      },
    ],
  },
})
