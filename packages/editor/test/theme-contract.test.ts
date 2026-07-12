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

  it("makes the standalone editor stylesheet self-contained for source consumers", () => {
    const editorCss = readEditorFile("src/editor.css")

    expect(editorCss.startsWith('@import "./theme.css";')).toBe(true)
  })

  it("tokenizes Dockview group backgrounds and renders the active tab indicator", () => {
    const workspaceCss = readEditorFile("src/workspace/workspace.css")

    expect(workspaceCss).toContain(
      "--dv-group-view-background-color: var(--composeui-surface-panel)",
    )
    expect(workspaceCss).toContain(
      "--dv-activegroup-hiddenpanel-tab-background-color: var(--composeui-surface-panel)",
    )
    expect(workspaceCss).toContain(
      "--dv-inactivegroup-hiddenpanel-tab-background-color: var(--composeui-surface-panel)",
    )

    const indicator = workspaceCss.match(
      /\.composeui-editor__workspace-host\s+\.dv-groupview\s+\.dv-tabs-and-actions-container\s+\.dv-tabs-container\s+> \.dv-tab\.dv-active-tab::after\s+\{([\s\S]*?)\}/,
    )?.[1]
    expect(indicator).toBeDefined()
    expect(indicator).toContain("position: absolute")
    expect(indicator).toContain('content: ""')
    expect(indicator).toContain("left: 0")
    expect(indicator).toContain("bottom: 0")
    expect(indicator).toContain("width: 100%")
    expect(indicator).toContain("height: 2px")
    expect(indicator).toContain("background: var(--composeui-accent-primary)")
  })
})
