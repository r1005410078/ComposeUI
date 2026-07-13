import type { OperationEvent, OperationLogQuery } from "./events"
import type { OperationCheckpoint } from "./checkpoints"
import type { OperationSession } from "./sessions"
import type { OperationLifecycleStore } from "./store"

const DATABASE_VERSION = 1
const STORE_SESSIONS = "sessions"
const STORE_EVENTS = "events"
const STORE_CHECKPOINTS = "checkpoints"
const STORE_METADATA = "metadata"

export interface IndexedDbOperationLogStoreOptions {
  databaseName: string
  version?: number
  indexedDB?: IDBFactory
  onListenerError?: (error: unknown) => void
}

export class IndexedDbOperationLogStore implements OperationLifecycleStore {
  static async open(
    options: IndexedDbOperationLogStoreOptions,
  ): Promise<IndexedDbOperationLogStore> {
    const factory = options.indexedDB ?? globalThis.indexedDB
    if (factory === undefined) throw new Error("INDEXEDDB_UNAVAILABLE")
    const version = options.version ?? DATABASE_VERSION
    if (version < DATABASE_VERSION) throw new Error("UNSUPPORTED_OPERATION_LOG_DOWNGRADE")

    const database = await openDatabase(factory, options.databaseName, version)
    return new IndexedDbOperationLogStore(database, options.onListenerError)
  }

  #database: IDBDatabase | undefined
  #listeners = new Set<() => void>()
  #onListenerError: ((error: unknown) => void) | undefined

  private constructor(
    database: IDBDatabase,
    onListenerError: ((error: unknown) => void) | undefined,
  ) {
    this.#database = database
    this.#onListenerError = onListenerError
    database.addEventListener("versionchange", () => database.close())
  }

  async append(events: readonly OperationEvent[]): Promise<void> {
    if (events.length === 0) return
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_EVENTS, "readwrite")
    const store = transaction.objectStore(STORE_EVENTS)
    const batch = structuredClone(events)
    return new Promise((resolve, reject) => {
      let failure: unknown
      transaction.addEventListener("complete", () => {
        if (failure === undefined) {
          this.#notify()
          resolve()
        } else {
          reject(failure)
        }
      })
      transaction.addEventListener("error", () =>
        reject(failure ?? transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED")),
      )
      transaction.addEventListener("abort", () =>
        reject(failure ?? transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED")),
      )

      const readRequest = store.getAll()
      readRequest.addEventListener("error", () => {
        failure = readRequest.error ?? new Error("INDEXEDDB_REQUEST_FAILED")
        transaction.abort()
      })
      readRequest.addEventListener("success", () => {
        try {
          validateAppendBatch(readRequest.result, batch)
          for (const event of batch) store.put(event)
        } catch (error) {
          failure = error
          transaction.abort()
        }
      })
    })
  }

  async query(query: OperationLogQuery): Promise<OperationEvent[]> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_EVENTS, "readonly")
    const events = await request<OperationEvent[]>(transaction.objectStore(STORE_EVENTS).getAll())
    await transactionComplete(transaction)
    return structuredClone(
      events
        .filter(
          (event) =>
            event.sessionId === query.sessionId &&
            (query.afterSequence === undefined || event.sequence > query.afterSequence),
        )
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
        .sort((left, right) => left.sequence - right.sequence),
    )
  }

  async putSession(session: OperationSession): Promise<void> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_SESSIONS, "readwrite")
    transaction.objectStore(STORE_SESSIONS).put(structuredClone(session))
    await transactionComplete(transaction)
    this.#notify()
  }

  async getSession(sessionId: string): Promise<OperationSession | undefined> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_SESSIONS, "readonly")
    const session = await request<OperationSession | undefined>(
      transaction.objectStore(STORE_SESSIONS).get(sessionId),
    )
    await transactionComplete(transaction)
    return session === undefined ? undefined : structuredClone(session)
  }

  async listSessions(projectId: string): Promise<OperationSession[]> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_SESSIONS, "readonly")
    const sessions = await request<OperationSession[]>(
      transaction.objectStore(STORE_SESSIONS).getAll(),
    )
    await transactionComplete(transaction)
    return structuredClone(
      sessions
        .filter((session) => session.projectId === projectId)
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
        .sort((left, right) =>
          left.startedAt < right.startedAt
            ? -1
            : left.startedAt > right.startedAt
              ? 1
              : left.sessionId < right.sessionId
                ? -1
                : left.sessionId > right.sessionId
                  ? 1
                  : 0,
        ),
    )
  }

  async deleteSession(sessionId: string): Promise<void> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(
      [STORE_SESSIONS, STORE_EVENTS, STORE_CHECKPOINTS],
      "readwrite",
    )
    return new Promise((resolve, reject) => {
      let failure: unknown
      transaction.addEventListener("complete", () => {
        if (failure === undefined) {
          this.#notify()
          resolve()
        } else {
          reject(failure)
        }
      })
      transaction.addEventListener("error", () =>
        reject(failure ?? transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED")),
      )
      transaction.addEventListener("abort", () =>
        reject(failure ?? transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED")),
      )

      transaction.objectStore(STORE_SESSIONS).delete(sessionId)
      registerSessionDeletes(transaction.objectStore(STORE_EVENTS), sessionId, () => {
        failure = new Error("INDEXEDDB_REQUEST_FAILED")
        transaction.abort()
      })
      registerSessionDeletes(transaction.objectStore(STORE_CHECKPOINTS), sessionId, () => {
        failure = new Error("INDEXEDDB_REQUEST_FAILED")
        transaction.abort()
      })
    })
  }

  async putCheckpoint(checkpoint: OperationCheckpoint): Promise<void> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_CHECKPOINTS, "readwrite")
    transaction.objectStore(STORE_CHECKPOINTS).put(structuredClone(checkpoint))
    await transactionComplete(transaction)
    this.#notify()
  }

  async getNearestCheckpoint(
    sessionId: string,
    sequence: number,
  ): Promise<OperationCheckpoint | undefined> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(STORE_CHECKPOINTS, "readonly")
    const checkpoints = await request<OperationCheckpoint[]>(
      transaction.objectStore(STORE_CHECKPOINTS).getAll(),
    )
    await transactionComplete(transaction)
    const nearest = checkpoints
      .filter((checkpoint) => checkpoint.sessionId === sessionId && checkpoint.sequence <= sequence)
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
      .sort((left, right) => right.sequence - left.sequence)[0]
    return nearest === undefined ? undefined : structuredClone(nearest)
  }

  async estimateUsage(): Promise<number> {
    const database = this.#requireDatabase()
    const transaction = database.transaction(
      [STORE_SESSIONS, STORE_EVENTS, STORE_CHECKPOINTS],
      "readonly",
    )
    const [sessions, events, checkpoints] = await Promise.all([
      request(transaction.objectStore(STORE_SESSIONS).getAll()),
      request(transaction.objectStore(STORE_EVENTS).getAll()),
      request(transaction.objectStore(STORE_CHECKPOINTS).getAll()),
    ])
    await transactionComplete(transaction)
    return estimateBytes([sessions, events, checkpoints])
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async close(): Promise<void> {
    this.#database?.close()
    this.#database = undefined
  }

  #requireDatabase(): IDBDatabase {
    if (this.#database === undefined) throw new Error("OPERATION_LOG_STORE_CLOSED")
    return this.#database
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch (error) {
        try {
          this.#onListenerError?.(error)
        } catch {
          // Error reporting must not break other subscribers.
        }
      }
    }
  }
}

function openDatabase(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = factory.open(name, version)
    openRequest.addEventListener("upgradeneeded", () => {
      if (openRequest.transaction === null) {
        reject(new Error("OPERATION_LOG_SCHEMA_UPGRADE_FAILED"))
        return
      }
      if (openRequest.result.version !== DATABASE_VERSION) {
        openRequest.transaction.abort()
        reject(new Error("UNSUPPORTED_OPERATION_LOG_SCHEMA"))
        return
      }
      createSchema(openRequest.result, openRequest.transaction)
    })
    openRequest.addEventListener("success", () => resolve(openRequest.result))
    openRequest.addEventListener("error", () =>
      reject(openRequest.error ?? new Error("OPERATION_LOG_OPEN_FAILED")),
    )
    openRequest.addEventListener("blocked", () => reject(new Error("OPERATION_LOG_OPEN_BLOCKED")))
  })
}

function createSchema(database: IDBDatabase, transaction: IDBTransaction): void {
  const sessions = database.objectStoreNames.contains(STORE_SESSIONS)
    ? transaction.objectStore(STORE_SESSIONS)
    : database.createObjectStore(STORE_SESSIONS, { keyPath: "sessionId" })
  const events = database.objectStoreNames.contains(STORE_EVENTS)
    ? transaction.objectStore(STORE_EVENTS)
    : database.createObjectStore(STORE_EVENTS, { keyPath: ["sessionId", "sequence"] })
  const checkpoints = database.objectStoreNames.contains(STORE_CHECKPOINTS)
    ? transaction.objectStore(STORE_CHECKPOINTS)
    : database.createObjectStore(STORE_CHECKPOINTS, { keyPath: ["sessionId", "sequence"] })
  if (!database.objectStoreNames.contains(STORE_METADATA)) {
    database.createObjectStore(STORE_METADATA, { keyPath: "key" })
  }
  void sessions
  void checkpoints
  ensureIndex(events, "eventId", "eventId", { unique: true })
  ensureIndex(events, "category", "category")
  ensureIndex(events, "type", "type")
  ensureIndex(events, "status", "status")
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
  options?: IDBIndexParameters,
): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options)
}

function validateAppendBatch(
  existing: readonly OperationEvent[],
  batch: readonly OperationEvent[],
): void {
  const eventIds = new Set(existing.map((event) => event.eventId))
  const lastSequences = new Map<string, number>()
  for (const event of existing) {
    const last = lastSequences.get(event.sessionId) ?? 0
    if (event.sequence > last) lastSequences.set(event.sessionId, event.sequence)
  }

  for (const event of batch) {
    if (eventIds.has(event.eventId)) throw new Error("DUPLICATE_OPERATION_EVENT")
    eventIds.add(event.eventId)
    const expected = (lastSequences.get(event.sessionId) ?? 0) + 1
    if (event.sequence !== expected) throw new Error("NON_CONTIGUOUS_OPERATION_SEQUENCE")
    lastSequences.set(event.sessionId, event.sequence)
  }
}

function registerSessionDeletes(
  store: IDBObjectStore,
  sessionId: string,
  onError: () => void,
): void {
  const readRequest = store.getAll()
  readRequest.addEventListener("error", onError)
  readRequest.addEventListener("success", () => {
    for (const value of readRequest.result as unknown[]) {
      if (isSessionValue(value, sessionId)) store.delete(storeKey(value))
    }
  })
}

function isSessionValue(value: unknown, sessionId: string): value is SessionKeyedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessionId" in value &&
    value.sessionId === sessionId
  )
}

function storeKey(value: unknown): IDBValidKey {
  const record = value as SessionKeyedValue
  return [record.sessionId, record.sequence]
}

interface SessionKeyedValue {
  sessionId: string
  sequence: number
}

function request<T = unknown>(requestValue: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestValue.addEventListener("success", () => resolve(requestValue.result))
    requestValue.addEventListener("error", () =>
      reject(requestValue.error ?? new Error("INDEXEDDB_REQUEST_FAILED")),
    )
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve())
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED")),
    )
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED")),
    )
  })
}

function estimateBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return 0
  }
}
