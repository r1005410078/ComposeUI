import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))
const workspaceCss = readFileSync(`${editorRoot}src/workspace/workspace.css`, "utf8")

describe("operation output workspace styles", () => {
  it("keeps the output toolbar fixed while the body fills the panel", () => {
    expect(workspaceCss).toContain(
      "grid-template-rows: var(--composeui-panel-toolbar-height) minmax(0, 1fr)",
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
