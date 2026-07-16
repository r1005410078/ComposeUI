/**
 * @module workspace/replay-controller
 *
 * 操作回放 UI 控制器：驱动 operation-log ReplayEngine 的 step/runTo/pause 等。
 *
 * EditorSessionReplayAdapter 将引擎对会话端口的写入落到 EditorSession。
 * 文档回放由引擎 + core 适配完成；本模块不直接 patch Store。
 *
 * 监听器失败不得中断回放状态机。
 */

import type {
  ReplayDifference,
  ReplayEngine,
  ReplayResult,
  ReplayState,
  ReplaySessionPort,
} from "@composeui/operation-log"
import type {
  EditorSession,
  EditorSessionState,
  InteractionMode,
  Viewport,
} from "../session/session"

export type ReplayEngineLike = Pick<
  ReplayEngine,
  "step" | "runTo" | "verify" | "continueBestEffort" | "getState"
>

export type ReplayEngineFactory = (targetSequence: number) => Promise<ReplayEngineLike>

export interface ReplayControllerOptions {
  readonly createEngine: ReplayEngineFactory
  readonly frameDelayMs?: number
  readonly wait?: (delayMs: number) => Promise<void>
}

/** 将 ReplaySessionPort 映射到现有 EditorSession（会话侧回放）。 */
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
  readonly frame?: ReplayState
  readonly error?: string
  readonly difference?: ReplayDifference
  readonly nondeterministicFromSequence?: number
}

export type ReplayControllerListener = (state: ReplayControllerState) => void

export interface ReplayControllerPort {
  readonly replayController?: ReplayController
  start(sequence: number): Promise<ReplayControllerState>
  pause(): ReplayControllerState
  resume(): Promise<ReplayControllerState>
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
  previousFrame?: ReplayState,
): ReplayControllerState {
  return {
    active,
    status,
    currentSequence: result.currentSequence,
    targetSequence: result.targetSequence,
    startedAtSequence: result.startedAtSequence,
    deterministic: result.deterministic,
    ...(result.state === undefined
      ? previousFrame === undefined
        ? {}
        : { frame: structuredClone(previousFrame) }
      : { frame: structuredClone(result.state) }),
    ...(result.difference === undefined ? {} : { difference: structuredClone(result.difference) }),
    ...(result.nondeterministicFromSequence === undefined
      ? {}
      : { nondeterministicFromSequence: result.nondeterministicFromSequence }),
  }
}

/**
 * 回放控制面：createEngine 懒创建引擎实例；frameDelayMs 控制连续播放节奏。
 * busy 期间拒绝交错命令，避免竞态。
 */
export class ReplayController implements ReplayControllerPort {
  readonly #createEngine: ReplayEngineFactory
  readonly #frameDelayMs: number
  readonly #wait: (delayMs: number) => Promise<void>
  readonly #listeners = new Set<ReplayControllerListener>()
  #engine: ReplayEngineLike | undefined
  #state: ReplayControllerState = { active: false, status: "idle", deterministic: true }
  #generation = 0
  #playback: Promise<void> | undefined

  constructor(options: ReplayControllerOptions) {
    this.#createEngine = options.createEngine
    this.#frameDelayMs = options.frameDelayMs ?? 300
    this.#wait =
      options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)))
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
      const checkpoint = engine.getState()
      const state = this.#publish({
        active: true,
        status: checkpoint.sequence >= sequence ? "completed" : "running",
        currentSequence: checkpoint.sequence,
        targetSequence: sequence,
        startedAtSequence: checkpoint.sequence,
        deterministic: true,
        frame: structuredClone(checkpoint),
      })
      if (checkpoint.sequence < sequence) {
        const playback = this.#playTo(generation, engine, sequence)
        this.#playback = playback
        void playback.catch((error) => {
          this.#recoverFromError(generation, error)
        })
      }
      return state
    } catch (error) {
      return this.#recoverStartError(generation, error)
    }
  }

  pause(): ReplayControllerState {
    if (!this.#state.active || this.#state.status !== "running") return this.getState()
    this.#generation += 1
    return this.#publish({ ...this.#state, status: "paused" })
  }

  async resume(): Promise<ReplayControllerState> {
    const engine = this.#requireEngine()
    const targetSequence = this.#state.targetSequence
    if (targetSequence === undefined) throw new Error("REPLAY_NOT_ACTIVE")
    if (this.#state.status === "running") return this.getState()

    const generation = ++this.#generation
    const state = this.#publishRunning()
    const previousPlayback = this.#playback
    const playback = (async () => {
      await previousPlayback
      if (generation !== this.#generation) return
      await this.#playTo(generation, engine, targetSequence)
    })()
    this.#playback = playback
    void playback.catch((error) => {
      this.#recoverFromError(generation, error)
    })
    return state
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

  async #playTo(
    generation: number,
    engine: ReplayEngineLike,
    targetSequence: number,
  ): Promise<void> {
    while (generation === this.#generation) {
      await this.#wait(this.#frameDelayMs)
      if (generation !== this.#generation) return

      const result = await engine.step(targetSequence)
      if (generation !== this.#generation) return
      if (result.difference !== undefined) {
        this.#applyResult(result, "paused")
        return
      }
      if (result.status === "completed" || result.currentSequence >= targetSequence) {
        this.#applyResult(result, "completed")
        return
      }
      this.#publish(stateFromResult(result, true, "running", this.#state.frame))
    }
  }

  #publishRunning(overrides: Partial<ReplayControllerState> = {}): ReplayControllerState {
    const { error: _error, ...withoutError } = this.#state
    return this.#publish({ ...withoutError, ...overrides, active: true, status: "running" })
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
    return this.#publish(stateFromResult(result, true, status, this.#state.frame))
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
