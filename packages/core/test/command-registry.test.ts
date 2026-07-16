import { describe, expect, it } from "vitest"
import { CommandRegistry } from "../src/kernel/commands/registry"
import type { CommandContribution } from "../src/kernel/commands/types"

function noopContribution(id: string): CommandContribution {
  return {
    id,
    prepare: () => ({
      ok: true,
      value: () => undefined,
      diagnostics: [],
    }),
  }
}

describe("CommandRegistry", () => {
  it("registers and looks up by id", () => {
    const reg = new CommandRegistry()
    const unregister = reg.register("plugin.a", noopContribution("demo.ping"))
    expect(reg.get("demo.ping")?.id).toBe("demo.ping")
    unregister()
    expect(reg.get("demo.ping")).toBeUndefined()
  })

  it("rejects duplicate command ids", () => {
    const reg = new CommandRegistry()
    reg.register("plugin.a", noopContribution("demo.ping"))
    expect(() => reg.register("plugin.b", noopContribution("demo.ping"))).toThrowError(
      expect.objectContaining({ code: "COMMAND_ID_CONFLICT" }),
    )
  })

  it("unregister is idempotent", () => {
    const reg = new CommandRegistry()
    const unregister = reg.register("plugin.a", noopContribution("demo.ping"))
    unregister()
    unregister()
    expect(reg.get("demo.ping")).toBeUndefined()
  })

  it("removes all commands for a plugin id", () => {
    const reg = new CommandRegistry()
    reg.register("plugin.a", noopContribution("a.1"))
    reg.register("plugin.a", noopContribution("a.2"))
    reg.removePlugin("plugin.a")
    expect(reg.get("a.1")).toBeUndefined()
    expect(reg.get("a.2")).toBeUndefined()
  })
})
