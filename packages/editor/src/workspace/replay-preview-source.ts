/**
 * @module workspace/replay-preview-source
 *
 * 把 ReplayController 状态投影为 EditorPreviewSource，供画布只读预览回放帧。
 * 解析 checkpoint 中的 document/session；非法结构时保持 inactive。
 */

import type { EditorPreviewFrame, EditorPreviewSource } from "../editor-view"
import type { EditorSessionState } from "../session"
import type { ReplayControllerPort, ReplayControllerState } from "./replay-controller"

export interface ReplayPreviewSource extends EditorPreviewSource {
  dispose(): void
}

function cloneFrame(frame: EditorPreviewFrame): EditorPreviewFrame {
  return structuredClone(frame)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function readSession(value: unknown): EditorSessionState | undefined {
  if (!isRecord(value)) return undefined
  const viewport = value.viewport
  if (!isRecord(viewport)) return undefined
  const x = viewport.x
  const y = viewport.y
  const zoom = viewport.zoom
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !isStringArray(value.selection) ||
    !isStringArray(value.expanded) ||
    (typeof value.hoveredId !== "string" && value.hoveredId !== null) ||
    typeof value.gridVisible !== "boolean" ||
    (value.interactionMode !== "select" && value.interactionMode !== "pan")
  ) {
    return undefined
  }
  return {
    viewport: { x, y, zoom },
    selection: [...value.selection],
    expanded: [...value.expanded],
    hoveredId: value.hoveredId,
    gridVisible: value.gridVisible,
    interactionMode: value.interactionMode,
  }
}

function previewFrameFromState(state: ReplayControllerState): EditorPreviewFrame {
  const session = state.frame === undefined ? undefined : readSession(state.frame.session)
  return {
    active: state.active,
    ...(state.frame === undefined ? {} : { document: structuredClone(state.frame.document) }),
    ...(session === undefined ? {} : { session }),
    ...(state.currentSequence === undefined ? {} : { currentSequence: state.currentSequence }),
    ...(state.targetSequence === undefined ? {} : { targetSequence: state.targetSequence }),
  }
}

/** 订阅 controller，产出 active 预览帧；dispose 取消订阅。 */
export function createReplayPreviewSource(controller: ReplayControllerPort): ReplayPreviewSource {
  let current = previewFrameFromState(controller.getState())
  let disposed = false
  const listeners = new Set<(frame: EditorPreviewFrame) => void>()
  const unsubscribe = controller.subscribe((state) => {
    if (disposed) return
    current = previewFrameFromState(state)
    for (const listener of Array.from(listeners)) listener(cloneFrame(current))
  })

  return {
    getState(): EditorPreviewFrame {
      return cloneFrame(current)
    },
    subscribe(listener): () => void {
      if (disposed) return () => undefined
      listeners.add(listener)
      listener(cloneFrame(current))
      return () => listeners.delete(listener)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      listeners.clear()
      unsubscribe()
    },
  }
}
