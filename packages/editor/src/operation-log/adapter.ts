/**
 * @module operation-log-adapter
 *
 * 将会话操作桥接到 `@composeui/operation-log` 的 Recorder。
 *
 * 特判：viewport 高频更新合并为 deferred 单次记录，避免 pan/zoom 刷爆日志。
 * 其它 session 事件即时 deferred 快照。
 */

import type { OperationRecorder } from "@composeui/operation-log"
import type { EditorSessionOperationObserver, SessionOperation } from "../session/session"
export { EditorSessionReplayAdapter } from "../workspace/replay-controller"

/** 创建 Session → Recorder 观察者；record 失败由 recorder 自行处理，此处 fire-and-forget。 */
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
        // 合并：只保留调度窗口内最后一次 viewport
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
