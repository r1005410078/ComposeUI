import type { Diagnostic } from "./diagnostics"
import type { EditorCommand } from "./commands"
import type { HistoryEntry } from "./history"
import type { PageDocument } from "./schema"

export type EditorOperation =
  | { type: "document.command"; status: "started"; command: EditorCommand }
  | {
      type: "document.command"
      status: "succeeded"
      command: EditorCommand
      transaction: HistoryEntry
      before: PageDocument
      after: PageDocument
    }
  | {
      type: "document.command"
      status: "failed"
      command: EditorCommand
      diagnostics: Diagnostic[]
    }
  | {
      type: "history.undo" | "history.redo" | "history.jump"
      status: "succeeded" | "failed"
      transactionId?: string
      currentIndex: number
      diagnostics?: Diagnostic[]
    }

export interface EditorOperationObserver {
  observe(operation: EditorOperation): void
}
