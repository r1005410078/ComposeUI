import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))
const workspaceCss = readFileSync(`${editorRoot}src/workspace/workspace.css`, "utf8")

describe("operation output workspace styles", () => {
  it("keeps the output toolbar fixed while the body fills the panel", () => {
    expect(workspaceCss).toContain(
      "grid-template-rows: var(--composeui-panel-toolbar-height) auto minmax(0, 1fr)",
    )
    expect(workspaceCss).toContain(".composeui-editor__output-toolbar")
    expect(workspaceCss).toContain(".composeui-editor__output-body")
  })

  it("makes the list independently scrollable and details bounded", () => {
    expect(workspaceCss).toContain(".composeui-editor__output-list")
    expect(workspaceCss).toContain("overflow: auto")
    expect(workspaceCss).toContain(".composeui-editor__output-details-host")
    expect(workspaceCss).toContain("minmax(0, var(--composeui-output-details-width))")
  })

  it("keeps output errors in document flow", () => {
    expect(workspaceCss).toContain(".composeui-editor__output-error")
    expect(workspaceCss).toContain("grid-row: 2")
    const errorRule = workspaceCss.match(/\.composeui-editor__output-error\s*\{([\s\S]*?)\n\}/)?.[1]
    expect(errorRule).toBeDefined()
    expect(errorRule).not.toContain("position: absolute")
    expect(errorRule).not.toContain("position: fixed")
  })

  it("removes the details column when the output panel is narrow", () => {
    expect(workspaceCss).toContain("container-type: inline-size")
    expect(workspaceCss).toContain("@container (max-width: 720px)")
    expect(workspaceCss).toContain(".composeui-editor__output-details-host")
    expect(workspaceCss).toContain("display: none")
    expect(workspaceCss).toContain("grid-template-columns: minmax(0, 1fr)")
    expect(workspaceCss).toContain("min-width: 0")
  })

  it("keeps the viewport fallback separate from container-driven output layout", () => {
    expect(workspaceCss).toContain("@media (max-width: 720px)")
    expect(workspaceCss).toContain(
      ".composeui-editor__output-body {\n    grid-template-columns: minmax(0, 1fr);",
    )
  })

  it("styles output rows by level using semantic state tokens", () => {
    for (const level of ["error", "warning", "success"]) {
      expect(workspaceCss).toContain(`.composeui-editor__output-entry[data-level="${level}"]`)
    }
    expect(workspaceCss).toContain("var(--composeui-output-error)")
    expect(workspaceCss).toContain("var(--composeui-output-warning)")
    expect(workspaceCss).toContain("var(--composeui-output-success)")
  })

  it("keeps the themed scrollbar rules in the workspace stylesheet", () => {
    expect(workspaceCss).toContain("--composeui-scrollbar-thumb")
    expect(workspaceCss).toContain("::-webkit-scrollbar-thumb")
  })
})
