import type { OperationEvent, OperationLogQuery } from "./events"

export interface OperationLogStore {
  append(events: readonly OperationEvent[]): Promise<void>
  query(query: OperationLogQuery): Promise<OperationEvent[]>
  subscribe(listener: () => void): () => void
}

export interface MemoryOperationLogStoreOptions {
  onListenerError?: (error: unknown) => void
}

export class MemoryOperationLogStore implements OperationLogStore {
  #eventsBySession = new Map<string, OperationEvent[]>()
  #eventIds = new Set<string>()
  #listeners = new Set<() => void>()
  #onListenerError: ((error: unknown) => void) | undefined

  constructor(options: MemoryOperationLogStoreOptions = {}) {
    this.#onListenerError = options.onListenerError
  }

  async append(events: readonly OperationEvent[]): Promise<void> {
    const batch = structuredClone(events)
    const batchIds = new Set<string>()
    const nextSequences = new Map<string, number>()

    for (const event of batch) {
      if (this.#eventIds.has(event.eventId) || batchIds.has(event.eventId)) {
        throw new Error("DUPLICATE_OPERATION_EVENT")
      }
      batchIds.add(event.eventId)

      const expectedSequence =
        nextSequences.get(event.sessionId) ??
        (this.#eventsBySession.get(event.sessionId)?.at(-1)?.sequence ?? 0) + 1
      if (event.sequence !== expectedSequence) {
        throw new Error("NON_CONTIGUOUS_OPERATION_SEQUENCE")
      }
      nextSequences.set(event.sessionId, expectedSequence + 1)
    }

    for (const event of batch) {
      const sessionEvents = this.#eventsBySession.get(event.sessionId) ?? []
      sessionEvents.push(event)
      this.#eventsBySession.set(event.sessionId, sessionEvents)
      this.#eventIds.add(event.eventId)
    }

    if (batch.length > 0) {
      for (const listener of this.#listeners) {
        try {
          listener()
        } catch (error) {
          try {
            this.#onListenerError?.(error)
          } catch {
            // Error reporting must not break append or later listeners.
          }
        }
      }
    }
  }

  async query(query: OperationLogQuery): Promise<OperationEvent[]> {
    const events = this.#eventsBySession.get(query.sessionId) ?? []
    return structuredClone(
      events
        .filter(
          (event) => query.afterSequence === undefined || event.sequence > query.afterSequence,
        )
        // filter creates a new array, so sorting here does not mutate stored events.
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
        .sort((left, right) => left.sequence - right.sequence),
    )
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}
