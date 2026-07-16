/**
 * @module commands/registry
 *
 * 按 command id 索引的贡献表；与插件 id 关联以便整插件卸载。
 *
 * 边界：只负责注册/查找，不执行 prepare 或 transact。
 * 重复 command id 在注册期 throw，避免运行时静默覆盖。
 *
 * 数据流：installCommandPlugins → register → Editor.dispatch 用 get(id)
 */

import { EditorInitializationError } from "./errors"
import type { CommandContribution } from "./types"

/** 文档命令贡献注册表；按 id 查找，按 pluginId 批量移除。 */
export class CommandRegistry {
  #byId = new Map<string, { pluginId: string; contribution: CommandContribution }>()

  /**
   * 注册一条命令贡献。
   * 返回 unregister：幂等；仅当仍是同一 contribution 实例时删除，避免误删后注册者。
   */
  register(pluginId: string, contribution: CommandContribution): () => void {
    if (this.#byId.has(contribution.id)) {
      throw new EditorInitializationError(
        "COMMAND_ID_CONFLICT",
        `Command id already registered: ${contribution.id}`,
      )
    }
    this.#byId.set(contribution.id, { pluginId, contribution })
    return () => {
      const cur = this.#byId.get(contribution.id)
      if (cur?.contribution === contribution) this.#byId.delete(contribution.id)
    }
  }

  get(id: string): CommandContribution | undefined {
    return this.#byId.get(id)?.contribution
  }

  /** 移除某插件注册的全部命令（插件安装回滚 / dispose 用）。 */
  removePlugin(pluginId: string): void {
    for (const [id, entry] of this.#byId) {
      if (entry.pluginId === pluginId) this.#byId.delete(id)
    }
  }

  clear(): void {
    this.#byId.clear()
  }
}
