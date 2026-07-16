/**
 * @module workspace/layout-store
 *
 * 将 Dockview 布局 JSON 持久化到 StorageLike（通常 localStorage）。
 * 损坏或版本不匹配时 load 返回 undefined，由 workspace 回落默认布局。
 */

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
  return {
    async load(): Promise<StoredWorkspaceLayout | undefined> {
      const raw = storage.getItem(key)
      if (raw === null) return undefined

      try {
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
      storage.removeItem(key)
    },
  }
}

export type { StoredWorkspaceLayout, WorkspaceLayoutStore } from "./types"
