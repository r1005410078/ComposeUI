export interface Viewport {
  x: number
  y: number
  zoom: number
}

export type InteractionMode = "select" | "pan"

export interface EditorSessionState {
  viewport: Viewport
  selection: string[]
  expanded: string[]
  hoveredId: string | null
  gridVisible: boolean
  interactionMode: InteractionMode
}

export type SessionOperation =
  | { type: "session.selection"; selection: string[] }
  | { type: "session.viewport"; viewport: Viewport }
  | { type: "session.expandedTree"; expanded: string[] }
  | { type: "session.gridVisibility"; gridVisible: boolean }
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

export class EditorSession {
  readonly #operationObserver: EditorSessionOperationObserver | undefined
  #state: EditorSessionState = {
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    expanded: [],
    hoveredId: null,
    gridVisible: true,
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
      // Operation logging must not block session state changes.
    }
  }

  #emit(): void {
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
            // Listener failures must not interrupt the session notification queue.
          }
        }
      }
    } finally {
      this.#notifying = false
    }
  }
}
