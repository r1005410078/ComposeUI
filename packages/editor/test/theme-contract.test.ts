import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))
const readEditorFile = (path: string): string => readFileSync(`${editorRoot}${path}`, "utf8")
const playgroundStyles = fileURLToPath(
  new URL("../../../apps/playground/src/styles.css", import.meta.url),
)

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
      "--composeui-gap-compact",
      "--composeui-component-tree-width",
      "--composeui-tree-control-size",
      "--composeui-resize-handle-size",
      "--composeui-icon-size",
      "--composeui-workspace-min-width",
      "--composeui-workspace-min-width-compact",
      "--composeui-app-bar-height",
      "--composeui-toolbar-height",
      "--composeui-radius-control",
      "--composeui-radius-panel",
      "--composeui-scrollbar-track",
      "--composeui-scrollbar-thumb",
      "--composeui-scrollbar-thumb-hover",
      "--composeui-scrollbar-width",
      "--composeui-scrollbar-radius",
      "--composeui-font-family",
    ]) {
      expect(theme).toContain(`${token}:`)
    }
  })

  it("defines and consumes compact hierarchy tokens", () => {
    const theme = readEditorFile("src/theme.css")
    const editorCss = readEditorFile("src/editor.css")

    for (const token of [
      "--composeui-tree-row-height",
      "--composeui-tree-indent",
      "--composeui-tree-icon-size",
      "--composeui-tree-action-opacity",
      "--composeui-tree-row-hover",
      "--composeui-tree-row-selected",
      "--composeui-tree-drag-indicator",
    ]) {
      expect(theme, token).toContain(`${token}:`)
      expect(editorCss, token).toContain(`var(${token})`)
    }
  })

  it("keeps disabled hierarchy actions low contrast in active row states", () => {
    const editorCss = readEditorFile("src/editor.css")
    const activeOpacityRule = editorCss.indexOf(
      ".composeui-editor__tree-row:hover .composeui-editor__tree-action,",
    )
    const disabledOverrideStart = editorCss.indexOf(
      ".composeui-editor__tree-row:hover .composeui-editor__tree-action:disabled,",
    )
    const disabledOverrideEnd = editorCss.indexOf("\n\n", disabledOverrideStart)
    const disabledOverride = editorCss.slice(disabledOverrideStart, disabledOverrideEnd)

    for (const selector of [
      ".composeui-editor__tree-row:hover .composeui-editor__tree-action:disabled",
      ".composeui-editor__tree-row:focus-within .composeui-editor__tree-action:disabled",
      '.composeui-editor__tree-item[aria-selected="true"] .composeui-editor__tree-action:disabled',
    ]) {
      expect(editorCss).toContain(selector)
    }
    expect(activeOpacityRule).toBeGreaterThanOrEqual(0)
    expect(disabledOverrideStart).toBeGreaterThan(activeOpacityRule)
    expect(disabledOverride).toContain("opacity: var(--composeui-tree-action-opacity);")
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

  it("references shared dimension, radius, and spacing tokens in structural styles", () => {
    const editorCss = readEditorFile("src/editor.css")
    const workspaceCss = readEditorFile("src/workspace/workspace.css")

    expect(editorCss).toContain("var(--composeui-component-tree-width)")
    expect(editorCss).toContain("var(--composeui-radius-panel)")
    for (const token of ["--composeui-tree-control-size", "--composeui-resize-handle-size"]) {
      expect(editorCss, token).toContain(`var(${token})`)
    }
    for (const token of [
      "--composeui-gap-compact",
      "--composeui-icon-size",
      "--composeui-app-bar-height",
      "--composeui-toolbar-height",
      "--composeui-radius-panel",
      "--composeui-space-1",
      "--composeui-space-2",
      "--composeui-space-3",
      "--composeui-workspace-min-width",
      "--composeui-workspace-min-width-compact",
    ]) {
      expect(workspaceCss, token).toContain(`var(${token})`)
    }
    for (const token of ["--composeui-space-1", "--composeui-space-2"]) {
      expect(editorCss, token).toContain(`var(${token})`)
    }
  })

  it("keeps playground controls on the editor theme", () => {
    const styles = readFileSync(playgroundStyles, "utf8")

    for (const token of [
      "--composeui-surface-control",
      "--composeui-surface-control-hover",
      "--composeui-surface-panel",
      "--composeui-text-primary",
      "--composeui-border-default",
      "--composeui-border-strong",
      "--composeui-space-2",
      "--composeui-space-3",
      "--composeui-radius-control",
      "--composeui-icon-button-size",
      "--composeui-icon-size",
    ]) {
      expect(styles, token).toContain(`var(${token})`)
    }
    expect(styles.match(/#[0-9a-f]{3,8}|rgb\([^)]*\)/gi) ?? []).toEqual([])
  })

  it("styles editor scroll containers with themed native scrollbars", () => {
    const editorCss = readEditorFile("src/editor.css")
    const workspaceCss = readEditorFile("src/workspace/workspace.css")
    const scrollbarCss = `${editorCss}\n${workspaceCss}`

    for (const token of [
      "--composeui-scrollbar-track",
      "--composeui-scrollbar-thumb",
      "--composeui-scrollbar-thumb-hover",
      "--composeui-scrollbar-width",
      "--composeui-scrollbar-radius",
    ]) {
      expect(scrollbarCss, token).toContain(`var(${token})`)
    }
    expect(scrollbarCss).toContain("scrollbar-color:")
    expect(scrollbarCss).toContain("scrollbar-width: thin")
    for (const selector of [
      "::-webkit-scrollbar",
      "::-webkit-scrollbar-track",
      "::-webkit-scrollbar-thumb",
      "::-webkit-scrollbar-thumb:hover",
    ]) {
      expect(scrollbarCss, selector).toContain(selector)
    }
    expect(workspaceCss).toContain(
      "--dv-scrollbar-background-color: var(--composeui-scrollbar-track)",
    )
  })
})
