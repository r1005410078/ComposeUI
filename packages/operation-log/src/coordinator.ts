import type { PageDocument } from "@composeui/core"
import type { OperationCheckpoint } from "./checkpoints"
import type { OperationRecorder } from "./recorder"
import type { OperationSession } from "./sessions"
import type { OperationLifecycleStore } from "./store"

export interface OperationSnapshot {
  document: PageDocument
  sessionState: unknown
  documentHash: string
  sessionHash: string
}

export interface OperationCoordinatorClock {
  now(): string
}

export interface OperationCoordinatorLifecycle {
  onHidden?(flush: () => Promise<void>): void | (() => void)
  onDispose?(flush: () => Promise<void>): void | (() => void)
}

export interface OperationLogCoordinatorOptions {
  store: OperationLifecycleStore
  recorder: OperationRecorder
  snapshot: () => OperationSnapshot | Promise<OperationSnapshot>
  clock?: OperationCoordinatorClock
  checkpointEveryEvents?: number
  checkpointEveryMs?: number
  lifecycle?: OperationCoordinatorLifecycle
}

export interface OperationRecoveryOptions {
  projectId?: string
  staleAfterMs?: number
}

const defaultClock: OperationCoordinatorClock = {
  now: () => new Date().toISOString(),
}

export class OperationLogCoordinator {
  static async start(options: OperationLogCoordinatorOptions): Promise<OperationLogCoordinator> {
    const coordinator = new OperationLogCoordinator(options)
    await coordinator.#start()
    return coordinator
  }

  static async recover(
    store: OperationLifecycleStore,
    now: string,
    projectIdOrOptions?: string | OperationRecoveryOptions,
  ): Promise<void> {
    const options =
      typeof projectIdOrOptions === "string"
        ? { projectId: projectIdOrOptions, staleAfterMs: 0 }
        : (projectIdOrOptions ?? { staleAfterMs: 0 })
    const nowMs = Date.parse(now)
    if (!Number.isFinite(nowMs)) throw new Error("INVALID_OPERATION_RECOVERY_TIME")
    const staleAfterMs = options.staleAfterMs ?? 0
    const sessions = await store.listSessions(options.projectId)
    await Promise.all(
      sessions
        .filter(
          (session) =>
            session.status === "active" && nowMs - Date.parse(session.startedAt) >= staleAfterMs,
        )
        .map((session) => store.putSession({ ...session, status: "abnormal" })),
    )
  }

  readonly #store: OperationLifecycleStore
  readonly #recorder: OperationRecorder
  readonly #snapshot: OperationLogCoordinatorOptions["snapshot"]
  readonly #clock: OperationCoordinatorClock
  readonly #checkpointEveryEvents: number
  readonly #checkpointEveryMs: number
  readonly #lifecycle: OperationCoordinatorLifecycle | undefined
  readonly #sessionId: string
  readonly #projectId: string
  readonly #cleanup: Array<() => void> = []
  #session: OperationSession
  #lastCheckpointAt: string
  #documentEventsSinceCheckpoint = 0
  #ended = false
  #pending: Promise<void> = Promise.resolve()

  private constructor(options: OperationLogCoordinatorOptions) {
    this.#store = options.store
    this.#recorder = options.recorder
    this.#snapshot = options.snapshot
    this.#clock = options.clock ?? defaultClock
    this.#checkpointEveryEvents = options.checkpointEveryEvents ?? 100
    this.#checkpointEveryMs = options.checkpointEveryMs ?? 30_000
    this.#lifecycle = options.lifecycle
    if (!Number.isInteger(this.#checkpointEveryEvents) || this.#checkpointEveryEvents <= 0) {
      throw new Error("INVALID_OPERATION_CHECKPOINT_CADENCE")
    }
    if (!Number.isFinite(this.#checkpointEveryMs) || this.#checkpointEveryMs <= 0) {
      throw new Error("INVALID_OPERATION_CHECKPOINT_CADENCE")
    }
    this.#sessionId = getRecorderString(options.recorder, "sessionId")
    this.#projectId = getRecorderString(options.recorder, "projectId")
    this.#lastCheckpointAt = this.#clock.now()
    this.#session = {
      sessionId: this.#sessionId,
      projectId: this.#projectId,
      status: "active",
      startedAt: this.#lastCheckpointAt,
      eventCount: 0,
    }
    this.#installLifecycleHooks()
  }

  async #start(): Promise<void> {
    const event = await this.#recorder.record({
      category: "system",
      type: "system.sessionStarted",
      status: "observed",
      payload: {},
    })
    this.#session.eventCount = event.sequence
    await this.#store.putSession(this.#session)
  }

  #installLifecycleHooks(): void {
    const flush = (): Promise<void> => this.flush()
    const hiddenCleanup = this.#lifecycle?.onHidden?.(flush)
    const disposeCleanup = this.#lifecycle?.onDispose?.(flush)
    if (hiddenCleanup !== undefined) this.#cleanup.push(hiddenCleanup)
    if (disposeCleanup !== undefined) this.#cleanup.push(disposeCleanup)
  }

  documentEvent(sequence?: number): Promise<void> {
    const task = this.#pending.then(async () => {
      if (this.#ended) return
      this.#documentEventsSinceCheckpoint += 1
      if (sequence !== undefined)
        this.#session.eventCount = Math.max(this.#session.eventCount, sequence)
      const now = this.#clock.now()
      const elapsed = Date.parse(now) - Date.parse(this.#lastCheckpointAt)
      await this.#store.putSession(this.#session)
      if (
        this.#documentEventsSinceCheckpoint >= this.#checkpointEveryEvents ||
        elapsed >= this.#checkpointEveryMs
      ) {
        await this.#writeCheckpoint(sequence ?? this.#session.eventCount, now)
      }
    })
    this.#pending = task.catch(() => undefined)
    return task
  }

  async #writeCheckpoint(sequence: number, createdAt: string): Promise<void> {
    const snapshot = await this.#snapshot()
    const checkpoint: OperationCheckpoint = {
      sessionId: this.#sessionId,
      sequence,
      createdAt,
      ...structuredClone(snapshot),
    }
    await this.#store.putCheckpoint(checkpoint)
    const event = await this.#recorder.record({
      category: "system",
      type: "system.checkpoint",
      status: "observed",
      payload: { sequence, documentHash: snapshot.documentHash, sessionHash: snapshot.sessionHash },
    })
    this.#session.eventCount = Math.max(this.#session.eventCount, event.sequence)
    this.#documentEventsSinceCheckpoint = 0
    this.#lastCheckpointAt = createdAt
    await this.#store.putSession(this.#session)
  }

  async end(finalHash?: string): Promise<void> {
    if (this.#ended) return
    this.#ended = true
    await this.#pending
    await this.#recorder.flush()
    const event = await this.#recorder.record({
      category: "system",
      type: "system.sessionEnded",
      status: "observed",
      payload: finalHash === undefined ? {} : { finalHash },
    })
    await this.#recorder.flush()
    this.#session.status = "ended"
    this.#session.endedAt = this.#clock.now()
    this.#session.eventCount = Math.max(this.#session.eventCount, event.sequence)
    if (finalHash === undefined) delete this.#session.finalHash
    else this.#session.finalHash = finalHash
    await this.#store.putSession(this.#session)
    for (const cleanup of this.#cleanup.splice(0)) cleanup()
  }

  async flush(): Promise<void> {
    await this.#pending
    await this.#recorder.flush()
  }

  dispose(): void {
    for (const cleanup of this.#cleanup.splice(0)) cleanup()
    void this.flush()
  }
}

function getRecorderString(recorder: OperationRecorder, key: "sessionId" | "projectId"): string {
  return key === "sessionId" ? recorder.sessionId : recorder.projectId
}
