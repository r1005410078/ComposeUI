import { describe, expect, it } from "vitest"
import type { UserConfig } from "vite"
import viteConfig from "../vite.config"
import { createM1Scenario } from "./m1-free-layout-scenario"
import { createPlaygroundLayoutStore } from "./main"

function createStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: (_key: string) => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
  }
}

describe("M1 Playground scenario", () => {
  it("persists the Dockview layout under the versioned playground key", async () => {
    const storage = createStorage()
    const store = createPlaygroundLayoutStore(storage)
    const layout = { root: { panels: [{ id: "canvas:page-1" }] } }

    await store.save({ version: 1, modeId: "2d", layout })

    expect(storage.getItem("composeui:workspace:2d:v2")).toContain('"modeId":"2d"')
    await expect(store.load()).resolves.toEqual({ version: 1, modeId: "2d", layout })
  })

  it("falls back to no layout when persisted JSON is malformed", async () => {
    const store = createPlaygroundLayoutStore(createStorage("{malformed"))

    await expect(store.load()).resolves.toBeUndefined()
  })

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
