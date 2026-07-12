import { describe, expect, it, vi } from "vitest"
import type { WorkspacePanelDescriptor, WorkspaceModeDescriptor } from "../src/workspace/types"
import { PanelRegistry } from "../src/workspace/panel-registry"
import { ModeRegistry } from "../src/workspace/mode-registry"

const mount = vi.fn()

function panel(id: string): WorkspacePanelDescriptor {
  return { id, title: id, mount }
}

function mode(id: string): WorkspaceModeDescriptor {
  return { id, title: id, createLayout: () => ({ id }) }
}

describe("workspace registries", () => {
  it("keeps panel registration order and rejects duplicate ids", () => {
    const registry = new PanelRegistry()

    registry.register(panel("scene"))
    registry.register(panel("canvas"))

    expect(registry.all().map((entry) => entry.id)).toEqual(["scene", "canvas"])
    expect(registry.get("scene")).toEqual(panel("scene"))
    expect(() => registry.register(panel("scene"))).toThrow("PANEL_ALREADY_REGISTERED")
  })

  it("shows the mode bar only when at least two modes are registered", () => {
    const registry = new ModeRegistry()

    expect(registry.shouldRenderModeBar()).toBe(false)
    registry.register(mode("2d"))
    expect(registry.shouldRenderModeBar()).toBe(false)
    registry.register(mode("script"))
    expect(registry.shouldRenderModeBar()).toBe(true)
    expect(registry.all().map((entry) => entry.id)).toEqual(["2d", "script"])
    expect(() => registry.register(mode("script"))).toThrow("MODE_ALREADY_REGISTERED")
  })
})
