import { describe, expect, it } from "vitest"
import { installCommandPlugins } from "../src/kernel/commands/plugin"
import { CommandRegistry } from "../src/kernel/commands/registry"
import type { CommandContribution, CommandPlugin } from "../src/kernel/commands/types"

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

describe("installCommandPlugins", () => {
  it("rolls back earlier plugins when a later plugin conflicts", () => {
    const reg = new CommandRegistry()
    const disposed: string[] = []
    const plugins: CommandPlugin[] = [
      {
        id: "first",
        register(api) {
          api.registerCommand(noopContribution("shared.id"))
          return () => disposed.push("first")
        },
      },
      {
        id: "second",
        register(api) {
          api.registerCommand(noopContribution("shared.id")) // conflict
        },
      },
    ]
    expect(() => installCommandPlugins(reg, plugins)).toThrowError(
      expect.objectContaining({ code: "COMMAND_ID_CONFLICT" }),
    )
    expect(reg.get("shared.id")).toBeUndefined()
    expect(disposed).toEqual(["first"])
  })

  it("rejects duplicate plugin ids", () => {
    const reg = new CommandRegistry()
    const plugins: CommandPlugin[] = [
      { id: "dup", register() {} },
      { id: "dup", register() {} },
    ]
    expect(() => installCommandPlugins(reg, plugins)).toThrowError(
      expect.objectContaining({ code: "PLUGIN_ID_CONFLICT" }),
    )
  })

  it("disposeAll removes commands and calls disposers once even if called twice", () => {
    const reg = new CommandRegistry()
    const disposed: string[] = []
    const installation = installCommandPlugins(reg, [
      {
        id: "a",
        register(api) {
          api.registerCommand(noopContribution("a.cmd"))
          return () => disposed.push("a")
        },
      },
      {
        id: "b",
        register(api) {
          api.registerCommand(noopContribution("b.cmd"))
          return () => disposed.push("b")
        },
      },
    ])

    expect(reg.get("a.cmd")?.id).toBe("a.cmd")
    expect(reg.get("b.cmd")?.id).toBe("b.cmd")

    installation.disposeAll()
    installation.disposeAll()

    expect(reg.get("a.cmd")).toBeUndefined()
    expect(reg.get("b.cmd")).toBeUndefined()
    expect(disposed).toEqual(["b", "a"])
  })

  it("wraps unknown plugin errors as PLUGIN_INSTALL_FAILED", () => {
    const reg = new CommandRegistry()
    const disposed: string[] = []
    const plugins: CommandPlugin[] = [
      {
        id: "ok",
        register(api) {
          api.registerCommand(noopContribution("ok.cmd"))
          return () => disposed.push("ok")
        },
      },
      {
        id: "bad",
        register() {
          throw new Error("boom")
        },
      },
    ]
    expect(() => installCommandPlugins(reg, plugins)).toThrowError(
      expect.objectContaining({ code: "PLUGIN_INSTALL_FAILED", cause: expect.any(Error) }),
    )
    expect(reg.get("ok.cmd")).toBeUndefined()
    expect(disposed).toEqual(["ok"])
  })
})
