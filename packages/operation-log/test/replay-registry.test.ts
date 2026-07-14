import { describe, expect, it } from "vitest"
import type { ReplayHandler } from "../src/replay/types"
import { ReplayHandlerRegistry } from "../src/replay/registry"

const handler: ReplayHandler = async () => undefined

describe("ReplayHandlerRegistry", () => {
  it("rejects duplicate handlers and reports unknown event types", () => {
    const registry = new ReplayHandlerRegistry()

    registry.register("document.command", handler)

    expect(() => registry.register("document.command", handler)).toThrow("DUPLICATE_REPLAY_HANDLER")
    expect(registry.resolve("plugin.unknown", 7)).toEqual({
      ok: false,
      difference: {
        type: "missing-handler",
        sequence: 7,
        eventType: "plugin.unknown",
      },
    })
  })

  it("returns registered handlers and unregisters only the matching handler", () => {
    const registry = new ReplayHandlerRegistry()
    const unregister = registry.register("document.command", handler)

    expect(registry.resolve("document.command")).toEqual({ ok: true, handler })

    unregister()

    expect(registry.resolve("document.command")).toEqual({
      ok: false,
      difference: expect.objectContaining({ type: "missing-handler" }),
    })
  })
})
