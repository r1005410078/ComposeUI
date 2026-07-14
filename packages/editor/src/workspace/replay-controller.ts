import type {
  ReplayDifference,
  ReplayEngine,
  ReplayResult,
  ReplaySessionPort,
} from "@composeui/operation-log"
import type { EditorSession, EditorSessionState, InteractionMode, Viewport } from "../session"

export type ReplayEngineLike = Pick<
  ReplayEngine,
  "step" | "runTo" | "verify" | "continueBestEffort" | "getState"
>

export type ReplayEngineFactory = (targetSequence: number) => Promise<ReplayEngineLike>

export class EditorSessionReplayAdapter implements ReplaySessionPort {
  readonly #session: EditorSession

  constructor(session: EditorSession) {
    this.#session = session
  }

  setSelection(ids: readonly string[]): void {
    this.#session.setSelection(ids)
  }

  setViewport(viewport: Viewport): void {
    this.#session.setViewport(viewport)
  }

  setInteractionMode(mode: InteractionMode): void {
    this.#session.setInteractionMode(mode)
  }

  setGridVisible(visible: boolean): void {
    this.#session.setGridVisible(visible)
  }

  setExpanded(ids: readonly string[]): void {
    const desired = [...new Set(ids)].reduce<string[]>((sorted, id) => {
      const index = sorted.findIndex((candidate) => candidate.localeCompare(id) > 0)
      if (index === -1) sorted.push(id)
      else sorted.splice(index, 0, id)
      return sorted
    }, [])
    for (const id of this.#session.getState().expanded) this.#session.toggleExpanded(id)
    for (const id of desired) this.#session.toggleExpanded(id)
  }

  getState(): EditorSessionState {
    return this.#session.getState()
  }
}

export interface ReplayControllerState {
  readonly active: boolean
  readonly status: "idle" | "running" | "paused" | "completed"
  readonly currentSequence?: number
  readonly targetSequence?: number
  readonly startedAtSequence?: number
  readonly deterministic: boolean
  readonly error?: string
  readonly difference?: ReplayDifference
  readonly nondeterministicFromSequence?: number
}

export type ReplayControllerListener = (state: ReplayControllerState) => void

export interface ReplayControllerPort {
  readonly replayController?: ReplayController
  start(sequence: number): Promise<ReplayControllerState>
  stepBackward(): Promise<ReplayControllerState>
  stepForward(): Promise<ReplayControllerState>
  runTo(sequence: number): Promise<ReplayControllerState>
  verify(): Promise<ReplayControllerState>
  continueBestEffort(): Promise<ReplayControllerState>
  stop(): void
  getState(): ReplayControllerState
  subscribe(listener: ReplayControllerListener): () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stateFromResult(
  result: ReplayResult,
  active: boolean,
  status: ReplayControllerState["status"],
): ReplayControllerState {
  return {
    active,
    status,
    currentSequence: result.currentSequence,
    targetSequence: result.targetSequence,
    startedAtSequence: result.startedAtSequence,
    deterministic: result.deterministic,
    ...(result.difference === undefined ? {} : { difference: structuredClone(result.difference) }),
    ...(result.nondeterministicFromSequence === undefined
      ? {}
      : { nondeterministicFromSequence: result.nondeterministicFromSequence }),
  }
}

export class ReplayController implements ReplayControllerPort {
  readonly #createEngine: ReplayEngineFactory
  readonly #listeners = new Set<ReplayControllerListener>()
  #engine: ReplayEngineLike | undefined
  #state: ReplayControllerState = { active: false, status: "idle", deterministic: true }
  #generation = 0

  constructor(options: { createEngine: ReplayEngineFactory }) {
    this.#createEngine = options.createEngine
  }

  get replayController(): ReplayController {
    return this
  }

  getState(): ReplayControllerState {
    return structuredClone(this.#state)
  }

  subscribe(listener: ReplayControllerListener): () => void {
    this.#listeners.add(listener)
    listener(this.getState())
    return () => this.#listeners.delete(listener)
  }

  async start(sequence: number): Promise<ReplayControllerState> {
    this.#assertSequence(sequence)
    const generation = ++this.#generation
    this.#engine = undefined
    this.#publish({ active: true, status: "running", deterministic: true })
    try {
      const engine = await this.#createEngine(sequence)
      if (generation !== this.#generation) return this.getState()
      this.#engine = engine
      const result = await engine.runTo(sequence)
      if (generation !== this.#generation) return this.getState()
      return this.#applyResult(result, "paused")
    } catch (error) {
      return this.#recoverStartError(generation, error)
    }
  }

  async stepBackward(): Promise<ReplayControllerState> {
    const current = this.#requireCurrentSequence()
    const target = Math.max(0, current - 1)
    const generation = ++this.#generation
    this.#publishRunning()
    try {
      const engine = await this.#createEngine(target)
      if (generation !== this.#generation) return this.getState()
      this.#engine = engine
      const result = await engine.runTo(target)
      if (generation !== this.#generation) return this.getState()
      return this.#applyResult(result, "paused")
    } catch (error) {
      return this.#recoverFromError(generation, error)
    }
  }

  async stepForward(): Promise<ReplayControllerState> {
    const engine = this.#requireEngine()
    const target = Number.MAX_SAFE_INTEGER
    const generation = ++this.#generation
    this.#publishRunning()
    return this.#execute(generation, () => engine.step(target), "paused")
  }

  async runTo(sequence: number): Promise<ReplayControllerState> {
    this.#assertSequence(sequence)
    const engine = this.#requireEngine()
    const generation = ++this.#generation
    this.#publishRunning({ targetSequence: sequence })
    return this.#execute(generation, () => engine.runTo(sequence), "paused")
  }

  async verify(): Promise<ReplayControllerState> {
    const engine = this.#requireEngine()
    const generation = ++this.#generation
    this.#publishRunning()
    return this.#execute(generation, () => engine.verify(), "completed")
  }

  async continueBestEffort(): Promise<ReplayControllerState> {
    const engine = this.#requireEngine()
    const generation = ++this.#generation
    this.#publishRunning()
    return this.#execute(generation, () => engine.continueBestEffort(), "completed")
  }

  stop(): void {
    this.#generation += 1
    this.#engine = undefined
    this.#publish({ active: false, status: "idle", deterministic: true })
  }

  async #execute(
    generation: number,
    operation: () => Promise<ReplayResult>,
    completedStatus: "paused" | "completed",
  ): Promise<ReplayControllerState> {
    try {
      const result = await operation()
      if (generation !== this.#generation) return this.getState()
      return this.#applyResult(result, completedStatus)
    } catch (error) {
      return this.#recoverFromError(generation, error)
    }
  }

  #publishRunning(overrides: Partial<ReplayControllerState> = {}): void {
    const { error: _error, ...withoutError } = this.#state
    this.#publish({ ...withoutError, ...overrides, active: true, status: "running" })
  }

  #recoverFromError(generation: number, error: unknown): ReplayControllerState {
    if (generation !== this.#generation) return this.getState()
    return this.#publish({
      ...this.#state,
      active: true,
      status: "paused",
      deterministic: false,
      error: errorMessage(error),
    })
  }

  #recoverStartError(generation: number, error: unknown): ReplayControllerState {
    if (generation !== this.#generation) return this.getState()
    this.#engine = undefined
    return this.#publish({
      active: false,
      status: "idle",
      deterministic: false,
      error: errorMessage(error),
    })
  }

  #applyResult(
    result: ReplayResult,
    completedStatus: "paused" | "completed",
  ): ReplayControllerState {
    const status = result.status === "completed" ? completedStatus : "paused"
    return this.#publish(stateFromResult(result, true, status))
  }

  #publish(next: ReplayControllerState): ReplayControllerState {
    this.#state = structuredClone(next)
    for (const listener of this.#listeners) {
      try {
        listener(this.getState())
      } catch {
        // UI listeners must not interrupt replay control.
      }
    }
    return this.getState()
  }

  #requireEngine(): ReplayEngineLike {
    if (this.#engine === undefined || !this.#state.active) throw new Error("REPLAY_NOT_ACTIVE")
    return this.#engine
  }

  #requireCurrentSequence(): number {
    if (this.#state.currentSequence === undefined) throw new Error("REPLAY_NOT_ACTIVE")
    return this.#state.currentSequence
  }

  #assertSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("INVALID_REPLAY_SEQUENCE")
  }
}

export type { ReplaySessionPort }
