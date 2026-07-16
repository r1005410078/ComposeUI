/**
 * @module commands/plugin
 *
 * 构造期按序安装 CommandPlugin；失败时逆序回滚，禁止运行时 installPlugin。
 *
 * 边界：
 * - 只负责插件生命周期与 registry 记账，不执行 prepare / dispatch
 * - 插件 disposer 仅释放私有资源；命令卸载以 registry 为准
 *
 * 数据流：plugins[] → register → CommandRegistry；失败 → reverse dispose + removePlugin
 */

import { EditorInitializationError } from "./errors"
import type { CommandRegistry } from "./registry"
import type { CommandPlugin, CommandPluginApi } from "./types"

export interface CommandPluginInstallation {
  /** 幂等：逆序调用插件 disposer，并移除本批安装的全部命令。 */
  disposeAll(): void
}

interface InstalledPlugin {
  pluginId: string
  disposer?: () => void
}

/**
 * 按数组顺序安装插件；任一步失败则逆序释放已成功项并 throw EditorInitializationError。
 * 成功后返回 disposeAll，供 Editor.dispose 统一卸载。
 */
export function installCommandPlugins(
  registry: CommandRegistry,
  plugins: readonly CommandPlugin[],
): CommandPluginInstallation {
  const installed: InstalledPlugin[] = []
  const seenIds = new Set<string>()

  /** 失败时逆序 disposer + 清空本批命令（含失败插件半注册项）。 */
  const rollback = (): void => {
    for (let i = installed.length - 1; i >= 0; i--) {
      const entry = installed[i]!
      try {
        entry.disposer?.()
      } catch {
        // 回滚路径不得被插件 disposer 阻断
      }
    }
    installed.length = 0
    registry.clear()
  }

  try {
    for (const plugin of plugins) {
      if (seenIds.has(plugin.id)) {
        throw new EditorInitializationError(
          "PLUGIN_ID_CONFLICT",
          `Plugin id already installed: ${plugin.id}`,
        )
      }
      seenIds.add(plugin.id)

      const api: CommandPluginApi = {
        registerCommand(contribution) {
          return registry.register(plugin.id, contribution)
        },
      }

      const disposer = plugin.register(api)
      installed.push({
        pluginId: plugin.id,
        disposer: typeof disposer === "function" ? disposer : undefined,
      })
    }
  } catch (error) {
    rollback()
    if (error instanceof EditorInitializationError) throw error
    throw new EditorInitializationError(
      "PLUGIN_INSTALL_FAILED",
      error instanceof Error ? error.message : "Plugin installation failed",
      { cause: error },
    )
  }

  let disposed = false
  return {
    disposeAll() {
      if (disposed) return
      disposed = true
      for (let i = installed.length - 1; i >= 0; i--) {
        const entry = installed[i]!
        try {
          entry.disposer?.()
        } catch {
          // dispose 幂等且不得被单个插件 disposer 阻断
        }
        registry.removePlugin(entry.pluginId)
      }
      installed.length = 0
    },
  }
}
