import type { OperationRecorder } from "@composeui/operation-log"
import type { EditorSessionOperationObserver, SessionOperation } from "./session"
export { EditorSessionReplayAdapter } from "./workspace/replay-controller"

export function createSessionOperationObserver(
  recorder: OperationRecorder,
): EditorSessionOperationObserver {
  let pendingViewport: SessionOperation | undefined
  let viewportScheduled = false

  const flushViewport = (): void => {
    pendingViewport = undefined
    viewportScheduled = false
  }

  return {
    observe(operation) {
      if (operation.type === "session.viewport") {
        pendingViewport = structuredClone(operation)
        if (!viewportScheduled) {
          viewportScheduled = true
          void recorder.recordDeferred(async () => {
            await Promise.resolve()
            const latest = pendingViewport
            flushViewport()
            if (latest === undefined) throw new Error("MISSING_VIEWPORT_OPERATION")
            return {
              category: "session",
              type: latest.type,
              status: "observed",
              payload: latest,
            }
          })
        }
        return
      }
      const snapshot = structuredClone(operation)
      void recorder.recordDeferred(async () => ({
        category: "session",
        type: snapshot.type,
        status: "observed",
        payload: snapshot,
      }))
    },
  }
}
