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
}

function assertValidZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("INVALID_ZOOM")
}

export class EditorSession {
  #state: EditorSessionState = {
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    expanded: [],
    hoveredId: null,
  }

  readonly #listeners = new Set<(state: EditorSessionState) => void>()

  getState(): EditorSessionState {
    return structuredClone(this.#state)
  }

  setViewport(viewport: Viewport): void {
    assertValidZoom(viewport.zoom)
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

  subscribe(listener: (state: EditorSessionState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(): void {
    const state = this.getState()
    for (const listener of this.#listeners) listener(state)
  }
}
