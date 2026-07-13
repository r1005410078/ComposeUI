import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))
const themeCss = readFileSync(`${editorRoot}src/theme.css`, "utf8")

describe("operation output theme tokens", () => {
  it("defines compact output density tokens", () => {
    for (const token of [
      "--composeui-output-row-height",
      "--composeui-output-time-width",
      "--composeui-output-details-width",
    ]) {
      expect(themeCss, token).toContain(`${token}:`)
    }
  })

  it("reuses existing semantic colors for output states", () => {
    expect(themeCss).toContain(
      "--composeui-output-row-hover: var(--composeui-surface-control-hover)",
    )
    expect(themeCss).toContain("--composeui-output-row-selected: var(--composeui-selection-fill)")
    expect(themeCss).toContain("--composeui-output-error: var(--composeui-state-danger)")
    expect(themeCss).toContain("--composeui-output-warning: var(--composeui-state-warning)")
    expect(themeCss).toContain("--composeui-output-success: var(--composeui-state-success)")
  })
})
