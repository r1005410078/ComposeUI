import type { StoredWorkspaceLayout, WorkspaceLayoutStore } from "./types"

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function isStoredWorkspaceLayout(value: unknown): value is StoredWorkspaceLayout {
  if (value === null || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1 &&
    candidate.modeId === "2d" &&
    Object.prototype.hasOwnProperty.call(candidate, "layout")
  )
}

export function createLocalStorageLayoutStore(
  storage: StorageLike,
  key: string,
): WorkspaceLayoutStore {
  const reset = async (): Promise<void> => {
    storage.removeItem(key)
  }

  return {
    async load(): Promise<StoredWorkspaceLayout | undefined> {
      try {
        const raw = storage.getItem(key)
        if (raw === null) return undefined
        const value: unknown = JSON.parse(raw)
        return isStoredWorkspaceLayout(value) ? value : undefined
      } catch {
        return undefined
      }
    },
    async save(layout: StoredWorkspaceLayout): Promise<void> {
      storage.setItem(key, JSON.stringify(layout))
    },
    async remove(): Promise<void> {
      await reset()
    },
    reset,
  }
}

export type { StoredWorkspaceLayout, WorkspaceLayoutStore } from "./types"
