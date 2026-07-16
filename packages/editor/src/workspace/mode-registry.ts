/**
 * @module workspace/mode-registry
 *
 * 工作区模式（如 2d 编辑）贡献点。多模式时才渲染 mode bar。
 * 当前产品默认单 2d mode；注册表为后续 3d/预览模式预留。
 */

import type { WorkspaceModeDescriptor } from "./types"

export class ModeRegistryError extends Error {
  readonly code: "MODE_ALREADY_REGISTERED"

  constructor(code: "MODE_ALREADY_REGISTERED", id: string) {
    super(`${code}: ${id}`)
    this.name = "ModeRegistryError"
    this.code = code
  }
}

export class ModeRegistry {
  readonly #modes = new Map<string, WorkspaceModeDescriptor>()

  register(mode: WorkspaceModeDescriptor): void {
    if (this.#modes.has(mode.id)) {
      throw new ModeRegistryError("MODE_ALREADY_REGISTERED", mode.id)
    }
    this.#modes.set(mode.id, mode)
  }

  get(id: string): WorkspaceModeDescriptor | undefined {
    return this.#modes.get(id)
  }

  has(id: string): boolean {
    return this.#modes.has(id)
  }

  all(): WorkspaceModeDescriptor[] {
    return [...this.#modes.values()]
  }

  shouldRenderModeBar(): boolean {
    return this.#modes.size >= 2
  }
}

export const WorkspaceModeRegistry = ModeRegistry

export function createModeRegistry(): ModeRegistry {
  return new ModeRegistry()
}
