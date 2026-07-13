import type {
  OperationCategory,
  OperationEvent,
  OperationLogStore,
  OperationStatus,
} from "@composeui/operation-log"

export type OperationLogFilterValue<T extends string> = T | readonly T[]

export interface OperationLogFilter {
  category?: OperationLogFilterValue<OperationCategory>
  status?: OperationLogFilterValue<OperationStatus>
  text?: string
}

export interface OperationLogControllerState {
  readonly rows: readonly OperationEvent[]
  readonly filter: OperationLogFilter
  readonly selection?: OperationEvent
  readonly detail?: OperationEvent
}

export interface OperationLogControllerOptions {
  store: OperationLogStore
  sessionId: string
}

export type OperationLogControllerListener = (state: OperationLogControllerState) => void

export class OperationLogController {
  readonly #store: OperationLogStore
  readonly #sessionId: string
  readonly #listeners = new Set<OperationLogControllerListener>()
  readonly #unsubscribeStore: () => void
  #rows: readonly OperationEvent[] = []
  #filter: OperationLogFilter = {}
  #selectedEventId: string | undefined
  #refreshGeneration = 0
  #disposed = false

  constructor(options: OperationLogControllerOptions) {
    this.#store = options.store
    this.#sessionId = options.sessionId
    this.#unsubscribeStore = options.store.subscribe(() => {
      void this.#refresh().catch(() => undefined)
    })
  }

  get rows(): readonly OperationEvent[] {
    return structuredClone(this.#rows)
  }

  get filter(): OperationLogFilter {
    return cloneFilter(this.#filter)
  }

  get selection(): OperationEvent | undefined {
    return cloneEvent(this.#selectedEvent())
  }

  get detail(): OperationEvent | undefined {
    return cloneEvent(this.#selectedEvent())
  }

  subscribe(listener: OperationLogControllerListener): () => void {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async query(filter: OperationLogFilter = {}): Promise<readonly OperationEvent[]> {
    this.#assertActive()
    this.#filter = normalizeFilter(filter)
    await this.#refresh()
    return this.rows
  }

  select(eventId: string | undefined): void {
    this.#assertActive()
    if (eventId !== undefined && !this.#rows.some((event) => event.eventId === eventId)) return
    if (this.#selectedEventId === eventId) return
    this.#selectedEventId = eventId
    this.#notify()
  }

  clearSelection(): void {
    this.select(undefined)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#refreshGeneration += 1
    this.#unsubscribeStore()
    this.#listeners.clear()
  }

  async #refresh(): Promise<void> {
    if (this.#disposed) return
    const generation = ++this.#refreshGeneration
    const events = await this.#store.query({ sessionId: this.#sessionId })
    if (this.#disposed || generation !== this.#refreshGeneration) return

    this.#rows = events
      .filter((event) => matchesFilter(event, this.#filter))
      .map((event) => structuredClone(event))
    if (this.#selectedEventId !== undefined && !this.#selectedEvent()) {
      this.#selectedEventId = undefined
    }
    this.#notify()
  }

  #selectedEvent(): OperationEvent | undefined {
    return this.#rows.find((event) => event.eventId === this.#selectedEventId)
  }

  #notify(): void {
    const state = this.#state()
    for (const listener of this.#listeners) listener(state)
  }

  #state(): OperationLogControllerState {
    const selection = this.#selectedEvent()
    return {
      rows: structuredClone(this.#rows),
      filter: cloneFilter(this.#filter),
      ...(selection === undefined
        ? {}
        : { selection: structuredClone(selection), detail: structuredClone(selection) }),
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("OPERATION_LOG_CONTROLLER_DISPOSED")
  }
}

function normalizeFilter(filter: OperationLogFilter): OperationLogFilter {
  return {
    ...(filter.category === undefined ? {} : { category: cloneFilterValue(filter.category) }),
    ...(filter.status === undefined ? {} : { status: cloneFilterValue(filter.status) }),
    ...(filter.text === undefined ? {} : { text: filter.text.trim() }),
  }
}

function cloneFilter(filter: OperationLogFilter): OperationLogFilter {
  return normalizeFilter(filter)
}

function cloneFilterValue<T extends string>(
  value: OperationLogFilterValue<T>,
): OperationLogFilterValue<T> {
  return Array.isArray(value) ? [...value] : value
}

function matchesFilter(event: OperationEvent, filter: OperationLogFilter): boolean {
  if (!matchesValue(event.category, filter.category)) return false
  if (!matchesValue(event.status, filter.status)) return false
  if (filter.text === undefined || filter.text.length === 0) return true

  const searchable = JSON.stringify({
    category: event.category,
    diagnostics: event.diagnostics,
    payload: event.payload,
    status: event.status,
    type: event.type,
  })
  return searchable.toLowerCase().includes(filter.text.toLowerCase())
}

function matchesValue<T extends string>(
  value: T,
  filter: OperationLogFilterValue<T> | undefined,
): boolean {
  if (filter === undefined) return true
  return Array.isArray(filter) ? filter.includes(value) : filter === value
}

function cloneEvent(event: OperationEvent | undefined): OperationEvent | undefined {
  return event === undefined ? undefined : structuredClone(event)
}
