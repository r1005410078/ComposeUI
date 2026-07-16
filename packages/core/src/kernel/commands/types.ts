/**
 * @module commands/types
 *
 * Command 插件贡献点、开放 dispatch 信封与内置 EditorCommand 联合的类型契约。
 *
 * 边界：
 * - `prepare` 只读 store，产出 draft mutator；不得直接 mutate store / 调用 transact
 * - `DispatchCommand` 是 registry、dispatch、operation observer 的最小公共形状
 * - `EditorCommand` 是 builtin 可辨识联合；宿主插件命令不必并入该联合
 *
 * 数据流：CommandPlugin.register → CommandPluginApi.registerCommand → dispatch(id)
 */

import type { Diagnostic, Result } from "../../shared/diagnostics"
import type { PageRecord } from "../../document/schema"
import type { RecordStore } from "../../store/store"
import type { HistoryEntry } from "../history"
import type { EditorOperationObserver } from "../operations"
import type { TransactionDraft, TransactionOrigin } from "../transaction"

/** 稳定命令 id，如 `"node.move"`。 */
export type CommandId = string

/**
 * 开放命令信封：builtin 与宿主插件命令共用的最小形状。
 * 具体 payload 由各 contribution 在 prepare 内收窄。
 */
export interface DispatchCommand {
  id: CommandId
  payload?: unknown
}

/**
 * 一条可注册的文档命令贡献。
 * prepare 失败返回 Result.ok=false；成功返回 draft 变更函数，由 Editor 在 transact 中执行。
 */
export interface CommandContribution {
  id: CommandId
  prepare(
    store: RecordStore,
    command: DispatchCommand,
  ): Result<(draft: TransactionDraft) => void>
  /** 可选：history 标签 / 日志展示 */
  label?: string
}

/**
 * 插件安装时拿到的注册 API；作用域属于当前插件，便于回滚与统一 dispose。
 */
export interface CommandPluginApi {
  registerCommand(contribution: CommandContribution): () => void
}

/**
 * 文档命令插件：向 API 注册零个或多个 CommandContribution。
 * 可返回 dispose；也可依赖 Editor 级 dispose 统一卸载。
 */
export interface CommandPlugin {
  id: string
  register(api: CommandPluginApi): void | (() => void)
}

/** 在 parent 下创建 rectangle；index 由 core 分配，调用方不指定同级序。 */
export interface CreateNodeCommand {
  id: "node.create"
  payload: {
    id: string
    parentId: string
    name: string
    x: number
    y: number
    width: number
    height: number
    fill: string
  }
}

/**
 * 平移一组节点。仅更新选中集合中的“顶层”节点，避免父子同选时双重位移。
 * 任一节点自身或祖先 locked 则整命令失败。
 */
export interface MoveNodeCommand {
  id: "node.move"
  payload: { ids: string[]; delta: { x: number; y: number } }
}

/** 单节点缩放；可选改 x/y（锚点拖拽时由 editor 计算）。 */
export interface ResizeNodeCommand {
  id: "node.resize"
  payload: { id: string; x?: number; y?: number; width: number; height: number }
}

/**
 * 多选等比/组缩放提交：≥2 个节点、同 parent、坐标尺寸一次写齐。
 * 指针预览应在 session，完成时再 dispatch 本命令。
 */
export interface ResizeManyNodeCommand {
  id: "node.resizeMany"
  payload: {
    items: Array<{ id: string; x: number; y: number; width: number; height: number }>
  }
}

/** 删除节点及其子树；禁止删 page。删除顺序由深到浅，保证 draft 一致性。 */
export interface DeleteNodeCommand {
  id: "node.delete"
  payload: { ids: string[] }
}

/**
 * 调整同级/跨 parent 顺序。若目标 index 被占用且仍在同 parent，
 * 与占用者交换 index，避免 sibling 冲突。
 */
export interface ReorderNodeCommand {
  id: "node.reorder"
  payload: { id: string; parentId: string; index: string }
}

export interface RenameNodeCommand {
  id: "node.rename"
  payload: { id: string; name: string }
}

export interface SetNodeVisibleCommand {
  id: "node.setVisible"
  payload: { id: string; visible: boolean }
}

export interface SetNodeLockedCommand {
  id: "node.setLocked"
  payload: { id: string; locked: boolean }
}

export interface SetPageOverflowCommand {
  id: "page.setOverflow"
  payload: { id: string; overflow: PageRecord["overflow"] }
}

/** 所有内置文档变更意图的可辨识联合；新增命令须同步 builtin prepare 与 operation log。 */
export type EditorCommand =
  | CreateNodeCommand
  | MoveNodeCommand
  | ResizeNodeCommand
  | ResizeManyNodeCommand
  | DeleteNodeCommand
  | ReorderNodeCommand
  | RenameNodeCommand
  | SetNodeVisibleCommand
  | SetNodeLockedCommand
  | SetPageOverflowCommand

/** 成功提交后广播给 UI 的变更事件（含新 store 与 history 条目）。 */
export interface EditorChangeEvent {
  store: RecordStore
  transaction: HistoryEntry
  origin: TransactionOrigin
}

export interface EditorOptions {
  onDiagnostic?: (diagnostic: Diagnostic) => void
  /** 旁路观察；异常不得阻断 dispatch。 */
  operationObserver?: EditorOperationObserver
  /** 构造期安装的宿主插件；排在 `composeui.builtin` 之后。 */
  plugins?: readonly CommandPlugin[]
}

/**
 * 单文档编辑会话的核心门面（非 DOM）。
 * 多实例互不共享 store/history；宿主每挂载一个 board 应 createEditor 一次。
 */
export interface Editor {
  readonly store: RecordStore
  dispatch(command: EditorCommand): Result<void>
  dispatch(command: DispatchCommand): Result<void>
  /** 与 dispatch 相同，保留兼容别名。 */
  execute(command: EditorCommand | DispatchCommand): Result<void>
  /** 幂等释放 core 侧插件、命令注册与 Editor 级 listener。 */
  dispose(): void
  getRecord(id: string): ReturnType<RecordStore["get"]>
  getStore(): RecordStore
  undo(): Result<void>
  redo(): Result<void>
  canUndo(): boolean
  canRedo(): boolean
  getHistory(): {
    past: HistoryEntry[]
    future: HistoryEntry[]
    entries: HistoryEntry[]
    currentIndex: number
  }
  jumpToHistory(index: number): Result<void>
  getDiagnostics(): Diagnostic[]
  /** 返回 dispose；listener 异常记诊断不摘掉其他监听。dispose 后订阅为 no-op。 */
  subscribe(listener: (event: EditorChangeEvent) => void): () => void
}

/** prepare 成功时返回的 draft mutator 包装；仅 builtin 内部使用。 */
export type PreparedCommand = Result<(draft: TransactionDraft) => void>
