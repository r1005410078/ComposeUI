import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"

function emitThemeCss(): Plugin {
  return {
    name: "composeui-emit-theme-css",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "theme.css",
        source: readFileSync(new URL("./src/styles/theme.css", import.meta.url), "utf8"),
      })
    },
  }
}

export default defineConfig({
  plugins: [emitThemeCss()],
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index", cssFileName: "editor" },
    rollupOptions: {
      external: ["@composeui/core", "@composeui/operation-log", "dockview", "lucide"],
    },
  },
})
