import { describe, expect, it, vi } from "vitest"
import * as editorApi from "../src/index"
import type { WorkspaceModeDescriptor, WorkspacePanelDescriptor } from "../src/workspace/types"
import { PanelRegistry, WorkspaceRegistryError } from "../src/workspace/panel-registry"
import { ModeRegistry, ModeRegistryError } from "../src/workspace/mode-registry"

const mount = vi.fn()

function panel(id: string): WorkspacePanelDescriptor {
  return { id, title: id, mount, closable: id !== "canvas", defaultPosition: "left" }
}

function mode(id: string): WorkspaceModeDescriptor {
  return {
    id,
    title: id,
    createLayout: () => ({ id }),
    toolbar: { items: [] },
  }
}

describe("workspace registries", () => {
  it("exports workspace contracts and factories from the package entrypoint", () => {
    expect(editorApi.PanelRegistry).toBe(PanelRegistry)
    expect(editorApi.ModeRegistry).toBe(ModeRegistry)
    expect(editorApi.createPanelRegistry).toBeTypeOf("function")
    expect(editorApi.createModeRegistry).toBeTypeOf("function")
    expect(editorApi.createLocalStorageLayoutStore).toBeTypeOf("function")
  })

  it("keeps panel registration order and rejects duplicate ids", () => {
    const registry = new PanelRegistry()

    registry.register(panel("scene"))
    registry.register(panel("canvas"))

    expect(registry.all().map((entry) => entry.id)).toEqual(["scene", "canvas"])
    expect(registry.get("scene")).toEqual(panel("scene"))
    try {
      registry.register(panel("scene"))
      throw new Error("expected duplicate panel registration to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceRegistryError)
      expect((error as WorkspaceRegistryError).code).toBe("PANEL_ALREADY_REGISTERED")
    }
  })

  it("shows the mode bar only when at least two modes are registered", () => {
    const registry = new ModeRegistry()

    expect(registry.shouldRenderModeBar()).toBe(false)
    registry.register(mode("2d"))
    expect(registry.shouldRenderModeBar()).toBe(false)
    registry.register(mode("script"))
    expect(registry.shouldRenderModeBar()).toBe(true)
    expect(registry.all().map((entry) => entry.id)).toEqual(["2d", "script"])
    try {
      registry.register(mode("script"))
      throw new Error("expected duplicate mode registration to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ModeRegistryError)
      expect((error as ModeRegistryError).code).toBe("MODE_ALREADY_REGISTERED")
    }
  })
})
