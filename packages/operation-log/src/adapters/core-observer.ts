import type { EditorOperation, EditorOperationObserver } from "@composeui/core"
import { hashCanonical } from "../canonical"
import type { OperationEvent } from "../events"
import type { OperationRecorder } from "../recorder"

export interface CoreOperationObserverOptions {
  onDocumentCommandSucceeded?: (sequence: number) => void | Promise<void>
}

function recordCoreOperation(
  recorder: OperationRecorder,
  operation: EditorOperation,
): Promise<OperationEvent | undefined> {
  if (operation.type === "document.command") {
    if (operation.status === "started") {
      return recorder.recordDeferred(async () => ({
        category: "document",
        type: operation.type,
        status: operation.status,
        payload: { command: operation.command },
      }))
    }
    if (operation.status === "failed") {
      return recorder.recordDeferred(async () => ({
        category: "document",
        type: operation.type,
        status: operation.status,
        diagnostics: operation.diagnostics,
        payload: { command: operation.command },
      }))
    }

    return recorder.recordDeferred(async () => {
      const [beforeHash, afterHash] = await Promise.all([
        hashCanonical(operation.before),
        hashCanonical(operation.after),
      ])
      return {
        category: "document",
        type: operation.type,
        status: operation.status,
        transactionId: operation.transaction.transactionId,
        beforeHash,
        afterHash,
        payload: {
          command: operation.command,
          transaction: operation.transaction,
          patch: operation.transaction.forward,
        },
      }
    })
  }

  return recorder.recordDeferred(async () => ({
    category: "history",
    type: operation.type,
    status: operation.status,
    ...(operation.transactionId === undefined ? {} : { transactionId: operation.transactionId }),
    ...(operation.diagnostics === undefined ? {} : { diagnostics: operation.diagnostics }),
    payload: { currentIndex: operation.currentIndex },
  }))
}

export function createCoreOperationObserver(
  recorder: OperationRecorder,
  options: CoreOperationObserverOptions = {},
): EditorOperationObserver {
  return {
    observe(operation) {
      const snapshot = structuredClone(operation)
      void recordCoreOperation(recorder, snapshot)
        .then((event) => {
          if (
            event === undefined ||
            snapshot.type !== "document.command" ||
            snapshot.status !== "succeeded"
          )
            return
          return options.onDocumentCommandSucceeded?.(event.sequence)
        })
        .catch(() => undefined)
    },
  }
}
