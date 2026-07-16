/**
 * @module commands
 *
 * 文档命令子系统公共出口：createEditor、插件类型、builtin 插件。
 */

export { createEditor } from "./editor"
export { EditorInitializationError } from "./errors"
export { installCommandPlugins } from "./plugin"
export type { CommandPluginInstallation } from "./plugin"
export { CommandRegistry } from "./registry"
export { builtinCommandPlugin, BUILTIN_COMMAND_PLUGIN_ID } from "./builtin"
export type {
  CommandContribution,
  CommandId,
  CommandPlugin,
  CommandPluginApi,
  CreateNodeCommand,
  DeleteNodeCommand,
  DispatchCommand,
  Editor,
  EditorChangeEvent,
  EditorCommand,
  EditorOptions,
  MoveNodeCommand,
  PreparedCommand,
  RenameNodeCommand,
  ReorderNodeCommand,
  ResizeManyNodeCommand,
  ResizeNodeCommand,
  SetNodeLockedCommand,
  SetNodeVisibleCommand,
  SetPageOverflowCommand,
} from "./types"
