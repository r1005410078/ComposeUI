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

    expect(entry.indexOf('"dockview/dist/styles/dockview.css"')).toBeLessThan(
      entry.indexOf('"./theme.css"'),
    )
    expect(entry.indexOf('"./theme.css"')).toBeLessThan(entry.indexOf('"./editor.css"'))
    expect(entry.indexOf('"./editor.css"')).toBeLessThan(
      entry.indexOf('"./workspace/workspace.css"'),
    )
  })

  it("exports a standalone theme stylesheet", () => {
    const packageJson = JSON.parse(readEditorFile("package.json")) as {
      exports: Record<string, string>
    }

    expect(packageJson.exports["./theme.css"]).toBe("./dist/theme.css")
  })
})
