import type { OperationEvent } from "./events"
import type { OperationLogStore as OperationLogStoreContract } from "./store"
import { defaultRedactor } from "./redaction"

export type RecordOperationInput<T = unknown> = Omit<
  OperationEvent<T>,
  "schemaVersion" | "eventId" | "sessionId" | "projectId" | "sequence" | "timestamp"
>

export type OperationRedactor = (payload: unknown) => unknown
export type OperationClock = () => string
export type OperationIdFactory = () => string
export type OperationDegradedHandler = (error: unknown, event: OperationEvent) => void

export interface OperationRecorderOptions {
  sessionId: string
  projectId: string
  store: OperationLogStoreContract
  redactor?: OperationRedactor
  clock?: OperationClock
  idFactory?: OperationIdFactory
  onDegraded?: OperationDegradedHandler
  /** @deprecated Use onDegraded. */
  degraded?: OperationDegradedHandler
}

export class OperationRecorder {
  readonly #sessionId: string
  readonly #projectId: string
  readonly #store: OperationLogStoreContract
  readonly #redactor: OperationRedactor
  readonly #clock: OperationClock
  readonly #idFactory: OperationIdFactory
  readonly #degraded: OperationDegradedHandler | undefined
  #sequence = 0
  #pending: Promise<void> = Promise.resolve()

  constructor(options: OperationRecorderOptions) {
    this.#sessionId = options.sessionId
    this.#projectId = options.projectId
    this.#store = options.store
    this.#redactor = options.redactor ?? defaultRedactor
    this.#clock = options.clock ?? (() => new Date().toISOString())
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID())
    this.#degraded = options.onDegraded ?? options.degraded
  }

  async record<T>(input: RecordOperationInput<T>): Promise<OperationEvent<T>> {
    const event: OperationEvent<T> = {
      ...input,
      schemaVersion: 1,
      eventId: this.#idFactory(),
      sessionId: this.#sessionId,
      projectId: this.#projectId,
      sequence: ++this.#sequence,
      timestamp: this.#clock(),
      payload: this.#redactor(input.payload) as T,
    }

    this.#pending = this.#pending.then(async () => {
      try {
        await this.#store.append([event])
      } catch (error) {
        try {
          this.#degraded?.(error, event)
        } catch {
          // A diagnostics hook must not break operation recording.
        }
      }
    })

    await this.#pending
    return structuredClone(event)
  }

  async flush(): Promise<void> {
    await this.#pending
  }
}
