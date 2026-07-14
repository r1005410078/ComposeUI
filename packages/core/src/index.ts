export type { Diagnostic, Result } from "./diagnostics"
export { createEditor } from "./commands"
export type { EditorOperation, EditorOperationObserver } from "./operations"
export type {
  CreateNodeCommand,
  DeleteNodeCommand,
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
} from "./commands"
export { History } from "./history"
export type { HistoryChange, HistoryEntry } from "./history"
export { getChildren, getTreeItems } from "./projections"
export type { TreeItem } from "./projections"
export { createEmptyDocument } from "./schema"
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
} from "./schema"
export { RecordStore } from "./store"
export { applyPatch, transact } from "./transaction"
export type {
  TransactionDraft,
  TransactionOrigin,
  TransactionPatch,
  TransactionResult,
  PatchApplyResult,
  UpdatedRecordPatch,
} from "./transaction"
export { canonicalizeDocument } from "./snapshot"
