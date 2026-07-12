import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))
const readEditorFile = (path: string): string => readFileSync(`${editorRoot}${path}`, "utf8")

describe("editor theme contract", () => {
  it("defines the required semantic token groups in one theme file", () => {
    const theme = readEditorFile("src/theme.css")

    for (const token of [
      "--composeui-surface-app",
      "--composeui-surface-panel",
      "--composeui-surface-canvas",
      "--composeui-text-primary",
      "--composeui-text-muted",
      "--composeui-border-default",
      "--composeui-accent-primary",
      "--composeui-canvas-grid-minor",
      "--composeui-control-height",
      "--composeui-radius-control",
      "--composeui-font-family",
    ]) {
      expect(theme).toContain(`${token}:`)
    }
  })

  it("loads Dockview first, then theme tokens, then structural styles", () => {
    const entry = readEditorFile("src/index.ts")
    const importIndices = [
      entry.indexOf('"dockview/dist/styles/dockview.css"'),
      entry.indexOf('"./theme.css"'),
      entry.indexOf('"./editor.css"'),
      entry.indexOf('"./workspace/workspace.css"'),
    ]

    expect(importIndices.every((index) => index >= 0)).toBe(true)

    expect(importIndices[0]).toBeLessThan(importIndices[1])
    expect(importIndices[1]).toBeLessThan(importIndices[2])
    expect(importIndices[2]).toBeLessThan(importIndices[3])
  })

  it("exports a standalone theme stylesheet", () => {
    const packageJson = JSON.parse(readEditorFile("package.json")) as {
      exports: Record<string, string>
    }

    expect(packageJson.exports["./theme.css"]).toBe("./dist/theme.css")
  })

  it("configures the build to emit the standalone theme asset", () => {
    const config = readEditorFile("vite.config.ts")

    expect(config).toContain('fileName: "theme.css"')
    expect(config).toContain('new URL("./src/theme.css", import.meta.url)')
  })

  it("keeps structural stylesheets free of palette literals", () => {
    for (const path of ["src/editor.css", "src/workspace/workspace.css"]) {
      const structuralCss = readEditorFile(path)
      const paletteLiterals = structuralCss.match(/#[0-9a-f]{3,8}|rgb\([^)]*\)/gi) ?? []

      expect(paletteLiterals, path).toEqual([])
    }
  })
})
