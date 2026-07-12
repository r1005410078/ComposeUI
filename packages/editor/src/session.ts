export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface EditorSessionState {
  viewport: Viewport
  selection: string[]
  expanded: string[]
  hoveredId: string | null
  gridVisible: boolean
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
  #state: EditorSessionState = {
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    expanded: [],
    hoveredId: null,
    gridVisible: true,
  }

  readonly #listeners = new Set<(state: EditorSessionState) => void>()
  readonly #pendingStates: EditorSessionState[] = []
  #notifying = false

  getState(): EditorSessionState {
    return structuredClone(this.#state)
  }

  setViewport(viewport: Viewport): void {
    assertValidViewport(viewport)
    this.#state = { ...this.#state, viewport: structuredClone(viewport) }
    this.#emit()
  }

  setSelection(selection: readonly string[]): void {
    this.#state = { ...this.#state, selection: [...new Set(selection)] }
    this.#emit()
  }

  toggleExpanded(id: string): void {
    const expanded = new Set(this.#state.expanded)
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    this.#state = { ...this.#state, expanded: [...expanded] }
    this.#emit()
  }

  setHoveredId(hoveredId: string | null): void {
    this.#state = { ...this.#state, hoveredId }
    this.#emit()
  }

  setGridVisible(gridVisible: boolean): void {
    this.#state = { ...this.#state, gridVisible }
    this.#emit()
  }

  subscribe(listener: (state: EditorSessionState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
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
