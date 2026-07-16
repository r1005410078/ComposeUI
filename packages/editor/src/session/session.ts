/**
 * @module session
 *
 * 编辑器会话态（Session Scope）：视口、选中、树展开、hover、网格与交互模式。
 *
 * 边界：
 * - 全部不进 PageDocument / RecordStore；宿主 save 时忽略本模块状态。
 * - 持久节点变更仍走 core `Editor.dispatch`。
 * - 与 core 的 Editor 一对一组合使用，禁止进程级单例。
 *
 * 数据流：指针/快捷键/树 UI → EditorSession setters → subscribe 重绘；
 * 可选 operationObserver → operation-log（旁路，失败吞掉）。
 */

import { assertValidGridSize } from "./snap"

/** Workspace 视口：平移偏移 + 缩放；非 page board 尺寸。 */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

export type InteractionMode = "select" | "pan"

export interface EditorSessionState {
  viewport: Viewport
  selection: string[]
  /** 组件树已展开节点 id（含 page）。 */
  expanded: string[]
  hoveredId: string | null
  gridVisible: boolean
  /** 次网格步长（world/local 同一数值语义）；默认 8。 */
  gridSize: number
  /** 是否启用吸附；默认 true。与 gridVisible 独立。 */
  snapEnabled: boolean
  interactionMode: InteractionMode
}

/** 会话侧可观察操作；与 core `EditorOperation` 分立，避免污染文档 log 语义。 */
export type SessionOperation =
  | { type: "session.selection"; selection: string[] }
  | { type: "session.viewport"; viewport: Viewport }
  | { type: "session.expandedTree"; expanded: string[] }
  | { type: "session.gridVisibility"; gridVisible: boolean }
  | { type: "session.gridSize"; gridSize: number }
  | { type: "session.snapEnabled"; snapEnabled: boolean }
  | { type: "session.interactionMode"; interactionMode: InteractionMode }
  | { type: "session.hoveredId"; hoveredId: string | null }

export interface EditorSessionOperationObserver {
  observe(operation: SessionOperation): void
}

export interface EditorSessionOptions {
  operationObserver?: EditorSessionOperationObserver
}

function assertValidZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("INVALID_ZOOM")
}

function assertValidViewport(viewport: Viewport): void {
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) {
    throw new Error("INVALID_COORDINATE")
  }
  assertValidZoom(viewport.zoom)
}

/**
 * 可变会话状态容器。setter 无变化时短路；通知队列可重入（listener 内再 set 会排到后续帧）。
 */
export class EditorSession {
  readonly #operationObserver: EditorSessionOperationObserver | undefined
  #state: EditorSessionState = {
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    expanded: [],
    hoveredId: null,
    gridVisible: true,
    gridSize: 8,
    snapEnabled: true,
    interactionMode: "select",
  }

  readonly #listeners = new Set<(state: EditorSessionState) => void>()
  readonly #pendingStates: EditorSessionState[] = []
  #notifying = false

  constructor(options: EditorSessionOptions = {}) {
    this.#operationObserver = options.operationObserver
  }

  getState(): EditorSessionState {
    return structuredClone(this.#state)
  }

  setViewport(viewport: Viewport): void {
    assertValidViewport(viewport)
    if (
      this.#state.viewport.x === viewport.x &&
      this.#state.viewport.y === viewport.y &&
      this.#state.viewport.zoom === viewport.zoom
    )
      return
    this.#state = { ...this.#state, viewport: structuredClone(viewport) }
    this.#observe({ type: "session.viewport", viewport })
    this.#emit()
  }

  setSelection(selection: readonly string[]): void {
    // 去重保序：先出现的 id 保留
    const next = [...new Set(selection)]
    if (
      next.length === this.#state.selection.length &&
      next.every((id, index) => id === this.#state.selection[index])
    )
      return
    this.#state = { ...this.#state, selection: next }
    this.#observe({ type: "session.selection", selection: next })
    this.#emit()
  }

  toggleExpanded(id: string): void {
    const expanded = new Set(this.#state.expanded)
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    this.#state = { ...this.#state, expanded: [...expanded] }
    this.#observe({ type: "session.expandedTree", expanded: [...this.#state.expanded] })
    this.#emit()
  }

  setHoveredId(hoveredId: string | null): void {
    if (this.#state.hoveredId === hoveredId) return
    this.#state = { ...this.#state, hoveredId }
    this.#observe({ type: "session.hoveredId", hoveredId })
    this.#emit()
  }

  setGridVisible(gridVisible: boolean): void {
    if (this.#state.gridVisible === gridVisible) return
    this.#state = { ...this.#state, gridVisible }
    this.#observe({ type: "session.gridVisibility", gridVisible })
    this.#emit()
  }

  setGridSize(gridSize: number): void {
    assertValidGridSize(gridSize)
    if (this.#state.gridSize === gridSize) return
    this.#state = { ...this.#state, gridSize }
    this.#observe({ type: "session.gridSize", gridSize })
    this.#emit()
  }

  setSnapEnabled(snapEnabled: boolean): void {
    if (this.#state.snapEnabled === snapEnabled) return
    this.#state = { ...this.#state, snapEnabled }
    this.#observe({ type: "session.snapEnabled", snapEnabled })
    this.#emit()
  }

  setInteractionMode(interactionMode: InteractionMode): void {
    if (this.#state.interactionMode === interactionMode) return
    this.#state = { ...this.#state, interactionMode }
    this.#observe({ type: "session.interactionMode", interactionMode })
    this.#emit()
  }

  subscribe(listener: (state: EditorSessionState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #observe(operation: SessionOperation): void {
    if (this.#operationObserver === undefined) return
    try {
      this.#operationObserver.observe(structuredClone(operation))
    } catch {
      // 操作日志不得阻断会话态更新
    }
  }

  #emit(): void {
    // 重入安全：通知期间的 set* 推入队列，本轮结束后继续刷，避免漏事件或栈溢出
    this.#pendingStates.push(this.getState())
    if (this.#notifying) return

    this.#notifying = true
    try {
      while (this.#pendingStates.length > 0) {
        const state = this.#pendingStates.shift()!
        const listeners = [...this.#listeners]
        for (const listener of listeners) {
          try {
            listener(structuredClone(state))
          } catch {
            // 单个 listener 失败不得中断队列
          }
        }
      }
    } finally {
      this.#notifying = false
    }
  }
}
