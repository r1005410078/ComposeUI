/**
 * @module @composeui/core
 *
 * ComposeUI 文档内核公共出口：schema、Store、事务、命令、History、投影。
 * 不依赖 Vue/React、DOM、Yjs、Playground。
 *
 * 推荐宿主用法：createEditor(document) → dispatch 命令 → subscribe 渲染；
 * 导出用 canonicalizeDocument(store)。会话态请用 @composeui/editor 的 EditorSession。
 */

export type { Diagnostic, Result } from "./shared/diagnostics"
export { createEditor } from "./kernel/commands"
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
  RenameNodeCommand,
  ReorderNodeCommand,
  ResizeNodeCommand,
  ResizeManyNodeCommand,
  SetPageOverflowCommand,
  SetNodeLockedCommand,
  SetNodeVisibleCommand,
} from "./kernel/commands"
export { EditorInitializationError } from "./kernel/commands"
export type { EditorOperation, EditorOperationObserver } from "./kernel/operations"
export { History } from "./kernel/history"
export type { HistoryChange, HistoryEntry } from "./kernel/history"
export { getChildren, getTreeItems } from "./query/tree"
export type { TreeItem } from "./query/tree"
export type { CreateLayoutProjection, LayoutProjection, ResolvedBox } from "./query/types"
export { createEmptyDocument } from "./document/schema"
export type {
  BaseRecord,
  DocumentRecord,
  EditorRecord,
  FreeLayout,
  NodeRecord,
  PageDocument,
  PageRecord,
  PersistentRecord,
  RecordUpdatePatch,
} from "./document/schema"
export { RecordStore } from "./store/store"
export { applyPatch, transact } from "./kernel/transaction"
export type {
  TransactionDraft,
  TransactionOrigin,
  TransactionPatch,
  TransactionResult,
  PatchApplyResult,
  UpdatedRecordPatch,
} from "./kernel/transaction"
export { canonicalizeDocument } from "./document/snapshot"
