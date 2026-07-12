import { describe, expect, it } from "vitest"
import { createLocalStorageLayoutStore, type StorageLike } from "../src/workspace/layout-store"
import type { StoredWorkspaceLayout } from "../src/workspace/types"

function createMemoryStorage(initial?: string): StorageLike & { value: string | null } {
  let value = initial ?? null
  return {
    get value() {
      return value
    },
    getItem() {
      return value
    },
    setItem(_key, next) {
      value = next
    },
    removeItem() {
      value = null
    },
  }
}

describe("workspace layout storage", () => {
  it("round-trips the versioned layout envelope through injected storage", async () => {
    const storage = createMemoryStorage()
    const store = createLocalStorageLayoutStore(storage, "workspace-layout")
    const layout: StoredWorkspaceLayout = { version: 1, modeId: "2d", layout: { panels: [] } }

    await store.save(layout)

    expect(await store.load()).toEqual(layout)
  })

  it("ignores malformed and incompatible stored layouts", async () => {
    const malformed = createMemoryStorage("{")
    const wrongVersion = createMemoryStorage(
      JSON.stringify({ version: 2, modeId: "2d", layout: {} }),
    )

    expect(await createLocalStorageLayoutStore(malformed, "key").load()).toBeUndefined()
    expect(await createLocalStorageLayoutStore(wrongVersion, "key").load()).toBeUndefined()
  })

  it("resets by removing the injected storage entry", async () => {
    const storage = createMemoryStorage(JSON.stringify({ version: 1, modeId: "2d", layout: {} }))
    const store = createLocalStorageLayoutStore(storage, "workspace-layout")

    await store.reset()

    expect(storage.value).toBeNull()
    expect(await store.load()).toBeUndefined()
  })
})
