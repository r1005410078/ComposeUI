/**
 * @module preview
 *
 * EditorPreviewSource 绑定：回放/只读帧覆盖 live store 与 session 展示。
 *
 * 边界：预览 store 由 createEditor(frame.document) 派生，只读展示，不经 host 写路径。
 * 数据流：preview.subscribe → apply 回调 → board/tree/overlay 重绘。
 */

import { createEditor } from "@composeui/core"
import type { PageDocument, RecordStore } from "@composeui/core"
import type { EditorSessionState } from "../session/session"

/** 预览帧：active=false 时视图回落 live editor。 */
export interface EditorPreviewFrame {
  readonly active: boolean
  readonly document?: PageDocument
  readonly session?: EditorSessionState
  readonly currentSequence?: number
  readonly targetSequence?: number
}

export interface EditorPreviewSource {
  getState(): EditorPreviewFrame
  subscribe(listener: (frame: EditorPreviewFrame) => void): () => void
}

export function previewStore(frame: EditorPreviewFrame): RecordStore | undefined {
  return frame.document === undefined ? undefined : createEditor(frame.document).getStore()
}

/**
 * 保证树侧至少展开当前 page（预览 session 可能未含 pageId）。
 */
export function treeSessionState(state: EditorSessionState, pageId: string): EditorSessionState {
  return state.expanded.includes(pageId)
    ? state
    : { ...state, expanded: [...state.expanded, pageId] }
}

export interface PreviewSubscriptionOptions {
  source?: EditorPreviewSource | undefined
  isDestroyed: () => boolean
  cancelActiveInteraction: () => void
  /** 应用下一帧（更新 store/session 展示并重绘）。 */
  applyFrame: (frame: EditorPreviewFrame) => void
}

/** 订阅预览源；无 source 时返回 undefined。 */
export function subscribePreview(options: PreviewSubscriptionOptions): (() => void) | undefined {
  return options.source?.subscribe((nextFrame) => {
    if (options.isDestroyed()) return
    options.cancelActiveInteraction()
    options.applyFrame(nextFrame)
  })
}

/** 回放横幅文案与 DOM 挂载；非 active 时移除。 */
export function updateReplayBanner(options: {
  previewFrame: EditorPreviewFrame
  shell: HTMLElement
  workspace: HTMLElement
  replayBanner: HTMLElement
}): void {
  const { previewFrame, shell, workspace, replayBanner } = options
  if (!previewFrame.active) {
    delete shell.dataset.replay
    replayBanner.remove()
    return
  }
  shell.dataset.replay = "true"
  const sequences = [
    previewFrame.currentSequence === undefined
      ? undefined
      : `当前 #${previewFrame.currentSequence}`,
    previewFrame.targetSequence === undefined ? undefined : `目标 #${previewFrame.targetSequence}`,
  ].filter((sequence): sequence is string => sequence !== undefined)
  replayBanner.textContent = ["回放预览", ...sequences].join(" ")
  workspace.append(replayBanner)
}
