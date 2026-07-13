import { beforeEach, describe, expect, it } from "vitest"
import { IDBFactory, indexedDB } from "fake-indexeddb"
import { createPlaygroundOperationRuntime } from "./main"

describe("playground operation log runtime", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("composeui-playground-operation-log-test")
  })

  it("creates one recorder/coordinator and persists editor operations", async () => {
    const runtime = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-test",
      indexedDB: new IDBFactory(),
    })

    runtime.scenario.createNode()
    await runtime.coordinator.flush()

    const rows = await runtime.controller.query({
      levels: [],
      categories: ["document"],
      search: "",
    })
    expect(rows.filter((event) => event.type === "document.command")).not.toHaveLength(0)

    await runtime.dispose()
  })

  it("restores the same session log after reopening the database", async () => {
    const first = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-test",
      indexedDB: new IDBFactory(),
    })
    first.scenario.createNode()
    await first.coordinator.flush()
    const before = await first.controller.query({ levels: [], categories: [], search: "" })
    await first.dispose()

    const second = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-test",
      indexedDB: first.indexedDB,
    })
    const after = await second.controller.query({ levels: [], categories: [], search: "" })
    expect(after.length).toBeGreaterThanOrEqual(before.length)
    expect(after.some((event) => event.type === "document.command")).toBe(true)
    await second.dispose()
  })
})
