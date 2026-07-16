/**
 * @module commands/builtin
 *
 * 内置文档命令插件 `composeui.builtin`。
 *
 * 今日全部 EditorCommand 变体由此插件注册；宿主插件 id 不得与其冲突。
 */

import type { CommandPlugin } from "../types"
import { nodeCreateContribution } from "./node-create"
import {
  nodeMoveContribution,
  nodeResizeContribution,
  nodeResizeManyContribution,
} from "./node-transform"
import {
  nodeDeleteContribution,
  nodeRenameContribution,
  nodeReorderContribution,
  nodeSetLockedContribution,
  nodeSetVisibleContribution,
} from "./node-tree"
import { pageSetOverflowContribution } from "./page"

/** 稳定 builtin 插件 id；宿主 `CommandPlugin.id` 不得与此冲突。 */
export const BUILTIN_COMMAND_PLUGIN_ID = "composeui.builtin" as const

export const builtinCommandPlugin: CommandPlugin = {
  id: BUILTIN_COMMAND_PLUGIN_ID,
  register(api) {
    api.registerCommand(nodeCreateContribution)
    api.registerCommand(nodeMoveContribution)
    api.registerCommand(nodeResizeContribution)
    api.registerCommand(nodeResizeManyContribution)
    api.registerCommand(nodeDeleteContribution)
    api.registerCommand(nodeReorderContribution)
    api.registerCommand(nodeRenameContribution)
    api.registerCommand(nodeSetVisibleContribution)
    api.registerCommand(nodeSetLockedContribution)
    api.registerCommand(pageSetOverflowContribution)
  },
}
