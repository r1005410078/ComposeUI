export type { Diagnostic, Result } from "./diagnostics"
export { createEditor } from "./commands"
export type {
  CreateNodeCommand,
  DeleteNodeCommand,
  Editor,
  EditorChangeEvent,
  EditorCommand,
  MoveNodeCommand,
  RenameNodeCommand,
  ReorderNodeCommand,
  ResizeNodeCommand,
  SetNodeLockedCommand,
  SetNodeVisibleCommand,
} from "./commands"
export { History } from "./history"
export type { HistoryChange, HistoryEntry } from "./history"
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
