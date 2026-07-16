/**
 * @module operations
 *
 * 文档侧可观察操作事件（operation log / 遥测 / 回放适配的入口契约）。
 *
 * 边界：
 * - 仅描述“发生了什么文档命令或 history 动作”，不写 Yjs、不写 UI。
 * - Observer 失败不得阻断编辑主路径（由 Editor 吞错并记诊断）。
 * - Session 操作（选中、视口等）在 `@composeui/editor` 的 SessionOperation，不在此联合类型。
 *
 * 数据流：Editor.dispatch / undo / redo / jump → observe → operation-log 适配器。
 */

import type { Diagnostic } from "./diagnostics"
import type { EditorCommand } from "./commands"
import type { HistoryEntry } from "./history"
import type { PageDocument } from "./schema"

/**
 * 一次文档编辑生命周期事件。
 * command 路径含 started/succeeded/failed；history 路径含 succeeded/failed。
 */
export type EditorOperation =
  | { type: "document.command"; status: "started"; command: EditorCommand }
  | {
      type: "document.command"
      status: "succeeded"
      command: EditorCommand
      transaction: HistoryEntry
      /** 规范化后的 before/after，供 log 与 golden 稳定对比。 */
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

/** 旁路观察者；实现不得依赖调用顺序以外的共享可变单例。 */
export interface EditorOperationObserver {
  observe(operation: EditorOperation): void
}
