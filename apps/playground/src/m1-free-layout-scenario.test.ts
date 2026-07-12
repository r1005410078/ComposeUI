import { describe, expect, it } from "vitest"
import type { UserConfig } from "vite"
import viteConfig from "../vite.config"
import { createM1Scenario } from "./m1-free-layout-scenario"

describe("M1 Playground scenario", () => {
  it("creates deterministic nodes and exports canonical JSON", () => {
    const scenario = createM1Scenario()

    expect(scenario.createNode().ok).toBe(true)
    expect(scenario.editor.getRecord("node-created-1")).toMatchObject({
      name: "Rectangle 1",
      parentId: "page-1",
      layout: { x: 120, y: 120, width: 180, height: 120 },
    })

    const exported = scenario.exportCanonicalJson()
    expect(exported).toContain('"id": "node-created-1"')
    expect(exported).not.toContain("viewport")
    expect(exported).not.toContain("selection")
    expect(exported.endsWith("\n")).toBe(true)
  })

  it("resolves workspace packages from source during development", () => {
    const aliases = (viteConfig as UserConfig).resolve?.alias
    expect(aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          find: "@composeui/editor/editor.css",
          replacement: expect.stringContaining("packages/editor/src/editor.css"),
        }),
        expect.objectContaining({
          find: "@composeui/editor",
          replacement: expect.stringContaining("packages/editor/src/index.ts"),
        }),
        expect.objectContaining({
          find: "@composeui/core",
          replacement: expect.stringContaining("packages/core/src/index.ts"),
        }),
      ]),
    )
  })
})
