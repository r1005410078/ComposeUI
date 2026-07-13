import type { OperationEvent, OperationLogStore } from "@composeui/operation-log"
import type {
  OperationLogControllerListener,
  OperationLogControllerPort,
  OperationLogControllerState,
  OperationLogFilter,
  OperationLogFilterValue,
  OperationLogViewQuery,
} from "./operation-log-controller-port"

export type {
  OperationLogControllerListener,
  OperationLogControllerPort,
  OperationLogControllerState,
  OperationLogFilter,
  OperationLogFilterValue,
  OperationLogLevel,
  OperationLogViewQuery,
} from "./operation-log-controller-port"

export interface OperationLogControllerOptions {
  store: OperationLogStore
  sessionId: string
  exportSession?: () => Promise<string>
  importBundle?: (serialized: string) => Promise<void>
  startReplay?: (sequence: number) => void | Promise<void>
}

export class OperationLogController implements OperationLogControllerPort {
  readonly #store: OperationLogStore
  readonly #sessionId: string
  readonly #exportSession: () => Promise<string>
  readonly #importBundle: (serialized: string) => Promise<void>
  readonly #startReplay: (sequence: number) => void | Promise<void>
  readonly #listeners = new Set<OperationLogControllerListener>()
  readonly #unsubscribeStore: () => void
  #rows: readonly OperationEvent[] = []
  #filter: OperationLogFilter = {}
  #viewQuery: OperationLogViewQuery = { levels: [], categories: [], search: "" }
  #selectedEventId: string | undefined
  #refreshGeneration = 0
  #disposed = false

  constructor(options: OperationLogControllerOptions) {
    this.#store = options.store
    this.#sessionId = options.sessionId
    this.#exportSession = options.exportSession ?? (async () => "")
    this.#importBundle = options.importBundle ?? (async () => undefined)
    this.#startReplay = options.startReplay ?? (() => undefined)
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

  get viewQuery(): OperationLogViewQuery {
    return cloneViewQuery(this.#viewQuery)
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

  async query(
    query: OperationLogViewQuery | OperationLogFilter = {},
  ): Promise<readonly OperationEvent[]> {
    this.#assertActive()
    if (isViewQuery(query)) {
      this.#viewQuery = normalizeViewQuery(query)
      this.#filter = legacyFilter(this.#viewQuery)
    } else {
      this.#filter = normalizeFilter(query)
      this.#viewQuery = viewQueryFromFilter(this.#filter)
    }
    await this.#refresh()
    return this.rows
  }

  exportSession(): Promise<string> {
    this.#assertActive()
    return this.#exportSession()
  }

  importBundle(serialized: string): Promise<void> {
    this.#assertActive()
    return this.#importBundle(serialized)
  }

  startReplay(sequence: number): void | Promise<void> {
    this.#assertActive()
    return this.#startReplay(sequence)
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
      .filter((event) => matchesViewQuery(event, this.#viewQuery))
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
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(state))
      } catch {
        // A view listener must not interrupt log refreshes or editing commands.
      }
    }
  }

  #state(): OperationLogControllerState {
    const selection = this.#selectedEvent()
    return {
      rows: structuredClone(this.#rows),
      query: cloneViewQuery(this.#viewQuery),
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

function isViewQuery(
  query: OperationLogViewQuery | OperationLogFilter,
): query is OperationLogViewQuery {
  return "levels" in query || "categories" in query || "search" in query
}

function normalizeViewQuery(query: OperationLogViewQuery): OperationLogViewQuery {
  return {
    levels: [...query.levels],
    categories: [...query.categories],
    search: query.search.trim(),
  }
}

function cloneViewQuery(query: OperationLogViewQuery): OperationLogViewQuery {
  return normalizeViewQuery(query)
}

function legacyFilter(query: OperationLogViewQuery): OperationLogFilter {
  return {
    ...(query.categories.length === 1 ? { category: query.categories[0] } : {}),
    ...(query.levels.length === 1 ? { status: query.levels[0] } : {}),
    ...(query.search.length > 0 ? { text: query.search } : {}),
  }
}

function viewQueryFromFilter(filter: OperationLogFilter): OperationLogViewQuery {
  return {
    levels: filter.status === undefined ? [] : toArray(filter.status),
    categories: filter.category === undefined ? [] : toArray(filter.category),
    search: filter.text ?? "",
  }
}

function toArray<T extends string>(value: T | readonly T[]): readonly T[] {
  return typeof value === "string" ? [value] : [...value]
}

function cloneFilter(filter: OperationLogFilter): OperationLogFilter {
  return normalizeFilter(filter)
}

function cloneFilterValue<T extends string>(
  value: OperationLogFilterValue<T>,
): OperationLogFilterValue<T> {
  return Array.isArray(value) ? [...value] : value
}

function matchesViewQuery(event: OperationEvent, query: OperationLogViewQuery): boolean {
  if (query.levels.length > 0 && !query.levels.includes(event.status)) return false
  if (query.categories.length > 0 && !query.categories.includes(event.category)) return false
  if (query.search.length === 0) return true
  return searchableText({
    category: event.category,
    diagnostics: event.diagnostics,
    payload: event.payload,
    status: event.status,
    type: event.type,
  }).includes(query.search.toLowerCase())
}

function searchableText(root: unknown): string {
  const seen = new WeakSet<object>()
  const chunks: string[] = []

  const visit = (value: unknown): void => {
    try {
      if (value === null) {
        chunks.push("null")
        return
      }
      switch (typeof value) {
        case "undefined":
        case "boolean":
        case "number":
        case "bigint":
        case "string":
        case "symbol":
          chunks.push(String(value).toLowerCase())
          return
        case "function":
          chunks.push("function")
          return
        case "object":
          if (seen.has(value)) {
            chunks.push("[circular]")
            return
          }
          seen.add(value)
          if (value instanceof Date) {
            chunks.push(value.toISOString().toLowerCase())
            return
          }
          if (value instanceof Map) {
            for (const [key, item] of value) {
              visit(key)
              visit(item)
            }
            return
          }
          if (value instanceof Set) {
            for (const item of value) visit(item)
            return
          }
          for (const key of Reflect.ownKeys(value)) {
            chunks.push(String(key).toLowerCase())
            const descriptor = Object.getOwnPropertyDescriptor(value, key)
            if (descriptor !== undefined && "value" in descriptor) visit(descriptor.value)
          }
          return
        default:
          return
      }
    } catch {
      chunks.push("[unavailable]")
    }
  }

  visit(root)
  return chunks.join(" ")
}

function cloneEvent(event: OperationEvent | undefined): OperationEvent | undefined {
  return event === undefined ? undefined : structuredClone(event)
}
