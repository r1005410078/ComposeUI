import type { OperationEvent, OperationLogQuery } from "./events"
import type { OperationCheckpoint } from "./checkpoints"
import type { OperationSession } from "./sessions"

export interface OperationLogStore {
  append(events: readonly OperationEvent[]): Promise<void>
  query(query: OperationLogQuery): Promise<OperationEvent[]>
  subscribe(listener: () => void): () => void
}

export interface OperationLifecycleStore extends OperationLogStore {
  putSession(session: OperationSession): Promise<void>
  getSession(sessionId: string): Promise<OperationSession | undefined>
  listSessions(projectId?: string): Promise<OperationSession[]>
  deleteSession(sessionId: string): Promise<void>
  putCheckpoint(checkpoint: OperationCheckpoint): Promise<void>
  getNearestCheckpoint(
    sessionId: string,
    sequence: number,
  ): Promise<OperationCheckpoint | undefined>
  estimateUsage(): Promise<number>
}

export interface MemoryOperationLogStoreOptions {
  onListenerError?: (error: unknown) => void
}

export class MemoryOperationLogStore implements OperationLifecycleStore {
  #eventsBySession = new Map<string, OperationEvent[]>()
  #eventIds = new Set<string>()
  #sessions = new Map<string, OperationSession>()
  #checkpointsBySession = new Map<string, OperationCheckpoint[]>()
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

  async putSession(session: OperationSession): Promise<void> {
    const next = structuredClone(session)
    validateSession(next)
    this.#sessions.set(next.sessionId, next)
    this.#notifyListeners()
  }

  async getSession(sessionId: string): Promise<OperationSession | undefined> {
    const session = this.#sessions.get(sessionId)
    return session === undefined ? undefined : structuredClone(session)
  }

  async listSessions(projectId?: string): Promise<OperationSession[]> {
    const sessions = [...this.#sessions.values()]
      .filter((session) => projectId === undefined || session.projectId === projectId)
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
      .sort((left, right) => {
        const byStartedAt = compareStrings(left.startedAt, right.startedAt)
        return byStartedAt || compareStrings(left.sessionId, right.sessionId)
      })
    return structuredClone(sessions)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const events = this.#eventsBySession.get(sessionId) ?? []
    for (const event of events) this.#eventIds.delete(event.eventId)
    this.#eventsBySession.delete(sessionId)
    this.#sessions.delete(sessionId)
    this.#checkpointsBySession.delete(sessionId)
    this.#notifyListeners()
  }

  async putCheckpoint(checkpoint: OperationCheckpoint): Promise<void> {
    const next = structuredClone(checkpoint)
    validateCheckpoint(next)
    const checkpoints = this.#checkpointsBySession.get(next.sessionId) ?? []
    const replacementIndex = checkpoints.findIndex((item) => item.sequence === next.sequence)
    if (replacementIndex === -1) {
      checkpoints.push(next)
    } else {
      checkpoints[replacementIndex] = next
    }
    checkpoints.sort((left, right) => left.sequence - right.sequence)
    this.#checkpointsBySession.set(next.sessionId, checkpoints)
    this.#notifyListeners()
  }

  async getNearestCheckpoint(
    sessionId: string,
    sequence: number,
  ): Promise<OperationCheckpoint | undefined> {
    const checkpoints = this.#checkpointsBySession.get(sessionId) ?? []
    let nearest: OperationCheckpoint | undefined
    for (const checkpoint of checkpoints) {
      if (checkpoint.sequence > sequence) break
      nearest = checkpoint
    }
    return nearest === undefined ? undefined : structuredClone(nearest)
  }

  async estimateUsage(): Promise<number> {
    return estimateValueBytes([
      [...this.#sessions.values()],
      [...this.#eventsBySession.values()],
      [...this.#checkpointsBySession.values()],
    ])
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

  #notifyListeners(): void {
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch (error) {
        try {
          this.#onListenerError?.(error)
        } catch {
          // Error reporting must not break a committed lifecycle update.
        }
      }
    }
  }
}

function validateSession(session: OperationSession): void {
  if (session.sessionId.length === 0 || session.projectId.length === 0) {
    throw new Error("INVALID_OPERATION_SESSION")
  }
  if (!Number.isInteger(session.eventCount) || session.eventCount < 0) {
    throw new Error("INVALID_OPERATION_SESSION")
  }
}

function validateCheckpoint(checkpoint: OperationCheckpoint): void {
  if (
    checkpoint.sessionId.length === 0 ||
    !Number.isInteger(checkpoint.sequence) ||
    checkpoint.sequence < 0
  ) {
    throw new Error("INVALID_OPERATION_CHECKPOINT")
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function estimateValueBytes(root: unknown): number {
  const seen = new WeakSet<object>()
  const pending: unknown[] = [root]
  let bytes = 0

  while (pending.length > 0) {
    const value = pending.pop()
    switch (typeof value) {
      case "undefined":
        bytes += 1
        continue
      case "boolean":
        bytes += 4
        continue
      case "number":
        bytes += 8
        continue
      case "bigint":
        bytes += encodedLength(value.toString(10))
        continue
      case "string":
        bytes += encodedLength(value)
        continue
      case "symbol":
        bytes += encodedLength(String(value))
        continue
      case "function":
        bytes += 8
        continue
      case "object":
        if (value === null || seen.has(value)) continue
        seen.add(value)
        bytes += 16

        if (value instanceof Date) {
          bytes += 8
          continue
        }
        if (value instanceof RegExp) {
          bytes += encodedLength(value.source) + encodedLength(value.flags)
          continue
        }
        if (value instanceof ArrayBuffer) {
          bytes += value.byteLength
          continue
        }
        if (ArrayBuffer.isView(value)) {
          bytes += value.byteLength
          continue
        }
        if (value instanceof Map) {
          for (const [key, mapValue] of value) {
            pending.push(key, mapValue)
          }
          continue
        }
        if (value instanceof Set) {
          for (const item of value) pending.push(item)
          continue
        }

        for (const key of Reflect.ownKeys(value)) {
          bytes += encodedLength(typeof key === "symbol" ? String(key) : key)
          const descriptor = Object.getOwnPropertyDescriptor(value, key)
          if (descriptor && "value" in descriptor) pending.push(descriptor.value)
        }
        continue
      default:
        continue
    }
  }

  return bytes
}

function encodedLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
