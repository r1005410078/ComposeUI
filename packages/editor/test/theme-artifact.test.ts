import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))

describe("editor theme artifact", () => {
  it("builds dist/theme.css byte-identically from src/theme.css", () => {
    execFileSync("bun", ["run", "build"], { cwd: editorRoot, stdio: "pipe" })

    const sourcePath = `${editorRoot}src/theme.css`
    const artifactPath = `${editorRoot}dist/theme.css`
    const bundledEditorPath = `${editorRoot}dist/editor.css`
    expect(existsSync(artifactPath)).toBe(true)
    expect(readFileSync(artifactPath, "utf8")).toBe(readFileSync(sourcePath, "utf8"))

    const bundledEditor = readFileSync(bundledEditorPath, "utf8")
    expect(bundledEditor.match(/--composeui-surface-app:/g)).toHaveLength(1)
  })
})
