import { canonicalizeDocument, createEditor } from "@composeui/core"
import type { Editor, PageDocument } from "@composeui/core"
import { hashCanonical } from "../canonical"
import type { OperationEvent } from "../events"
import type { LogBundleV1, LogBundleV2 } from "../bundle"
import { builtinReplayHandlers } from "./builtin-handlers"
import { ReplayHandlerRegistry } from "./registry"
import type {
  ReplayDifference,
  ReplayHandler,
  ReplayHandlerContext,
  ReplaySessionPort,
} from "./types"

export type ValidatedLogBundle = LogBundleV1 | LogBundleV2

export interface ReplayEngineCreateOptions {
  bundle: ValidatedLogBundle
  targetSequence?: number
  createSession: (initialState: unknown) => ReplaySessionPort | Promise<ReplaySessionPort>
  createEditor?: (document: PageDocument) => Editor
  approvedHandlers?: ReadonlyMap<string, ReplayHandler> | Readonly<Record<string, ReplayHandler>>
}

export type ReplayResultStatus = "completed" | "paused"

export interface ReplayState {
  sequence: number
  document: PageDocument
  session: unknown
}

export interface ReplayResult {
  status: ReplayResultStatus
  deterministic: boolean
  startedAtSequence: number
  currentSequence: number
  targetSequence: number
  difference?: ReplayDifference
  nondeterministicFromSequence?: number
  state: ReplayState
}

interface InternalResultOptions {
  status: ReplayResultStatus
  difference?: ReplayDifference
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function snapshotDocument(editor: Editor): PageDocument {
  return canonicalizeDocument(editor.getStore())
}

function eventSequence(event: OperationEvent): number {
  return event.sequence
}

function sortBySequence<T extends { sequence: number }>(items: readonly T[]): T[] {
  const sorted: T[] = []
  for (const item of items) {
    const index = sorted.findIndex((candidate) => candidate.sequence > item.sequence)
    if (index === -1) sorted.push(item)
    else sorted.splice(index, 0, item)
  }
  return sorted
}

function handlerEntries(
  handlers:
    | ReadonlyMap<string, ReplayHandler>
    | Readonly<Record<string, ReplayHandler>>
    | undefined,
): Iterable<readonly [string, ReplayHandler]> {
  if (handlers === undefined) return []
  if (handlers instanceof Map) return handlers.entries()
  return Object.entries(handlers)
}

/**
 * Replays a validated bundle in a newly-created core/session runtime.
 * No host adapters are accepted by this class; handlers always receive disabled side effects.
 */
export class ReplayEngine {
  readonly #editor: Editor
  readonly #session: ReplaySessionPort
  readonly #registry: ReplayHandlerRegistry
  readonly #events: OperationEvent[]
  readonly #startedAtSequence: number
  readonly #defaultTargetSequence: number
  #currentSequence: number
  #eventIndex = 0
  #paused = false
  #bestEffort = false
  #deterministic = true
  #firstDifference: ReplayDifference | undefined
  #nondeterministicFromSequence: number | undefined

  static async create(options: ReplayEngineCreateOptions): Promise<ReplayEngine> {
    if (!Number.isSafeInteger(options.targetSequence ?? 0) || (options.targetSequence ?? 0) < 0) {
      throw new Error("INVALID_REPLAY_TARGET_SEQUENCE")
    }
    const targetSequence = options.targetSequence ?? Number.MAX_SAFE_INTEGER
    const checkpoints = options.bundle.checkpoints.filter(
      (checkpoint) => checkpoint.sequence <= targetSequence,
    )
    const sortedCheckpoints = sortBySequence(checkpoints)
    const checkpoint = sortedCheckpoints.at(-1) ?? options.bundle.checkpoints[0]
    if (checkpoint === undefined) throw new Error("REPLAY_CHECKPOINT_NOT_FOUND")

    const session = await options.createSession(clone(checkpoint.sessionState))
    const createIsolatedEditor =
      options.createEditor ?? ((initialDocument: PageDocument) => createEditor(initialDocument))
    const editor = createIsolatedEditor(clone(checkpoint.document))
    const registry = new ReplayHandlerRegistry()
    for (const [type, handler] of Object.entries(builtinReplayHandlers))
      registry.register(type, handler)
    for (const [type, handler] of handlerEntries(options.approvedHandlers))
      registry.register(type, handler)

    return new ReplayEngine(
      options.bundle,
      editor,
      session,
      registry,
      checkpoint.sequence,
      targetSequence,
    )
  }

  private constructor(
    bundle: ValidatedLogBundle,
    editor: Editor,
    session: ReplaySessionPort,
    registry: ReplayHandlerRegistry,
    startedAtSequence: number,
    targetSequence: number,
  ) {
    this.#editor = editor
    this.#session = session
    this.#registry = registry
    this.#startedAtSequence = startedAtSequence
    this.#currentSequence = startedAtSequence
    this.#defaultTargetSequence =
      targetSequence === Number.MAX_SAFE_INTEGER
        ? (bundle.events.at(-1)?.sequence ?? startedAtSequence)
        : targetSequence
    this.#events = sortBySequence(
      bundle.events.filter((event) => event.sequence > startedAtSequence),
    )
    while (
      this.#eventIndex < this.#events.length &&
      this.#events[this.#eventIndex]!.sequence <= startedAtSequence
    ) {
      this.#eventIndex += 1
    }
  }

  async step(targetSequence = this.#defaultTargetSequence): Promise<ReplayResult> {
    if (this.#paused && !this.#bestEffort) return this.#result({ status: "paused" })
    const event = this.#nextEvent(targetSequence)
    if (event === undefined) return this.#result({ status: "completed" })
    this.#eventIndex += 1
    this.#currentSequence = eventSequence(event)
    const resolution = this.#registry.resolve(event.type, event.sequence)
    let difference: ReplayDifference | undefined
    if (!resolution.ok) difference = resolution.difference
    else {
      const context: ReplayHandlerContext = {
        editor: this.#editor,
        session: this.#session,
        sideEffects: "disabled",
      }
      difference = await resolution.handler(clone(event), context)
      if (difference === undefined && event.afterHash !== undefined) {
        const actual = await hashCanonical(snapshotDocument(this.#editor))
        if (actual !== event.afterHash) {
          difference = {
            type: "state-hash-mismatch",
            sequence: event.sequence,
            expected: event.afterHash,
            actual,
          }
        }
      }
    }

    if (difference !== undefined) {
      this.#deterministic = false
      this.#firstDifference ??= clone(difference)
      this.#nondeterministicFromSequence ??= event.sequence
      if (!this.#bestEffort) {
        this.#paused = true
        return this.#result({ status: "paused", difference })
      }
    }
    return this.#result({
      status: this.#nextEvent(targetSequence) === undefined ? "completed" : "paused",
    })
  }

  async runTo(targetSequence: number): Promise<ReplayResult> {
    if (!Number.isSafeInteger(targetSequence) || targetSequence < this.#startedAtSequence) {
      throw new Error("INVALID_REPLAY_TARGET_SEQUENCE")
    }
    while (!this.#paused || this.#bestEffort) {
      const event = this.#nextEvent(targetSequence)
      if (event === undefined) break
      await this.step(targetSequence)
      if (this.#paused && !this.#bestEffort) return this.#result({ status: "paused" })
    }
    return this.#result({
      status: this.#currentSequence >= targetSequence ? "completed" : "paused",
    })
  }

  async verify(): Promise<ReplayResult> {
    return this.runTo(this.#defaultTargetSequence)
  }

  async continueBestEffort(): Promise<ReplayResult> {
    this.#bestEffort = true
    this.#paused = false
    return this.runTo(this.#defaultTargetSequence)
  }

  getState(): ReplayState {
    return {
      sequence: this.#currentSequence,
      document: clone(snapshotDocument(this.#editor)),
      session: clone(this.#session.getState()),
    }
  }

  #nextEvent(targetSequence: number): OperationEvent | undefined {
    const event = this.#events[this.#eventIndex]
    return event !== undefined && event.sequence <= targetSequence ? event : undefined
  }

  #result(options: InternalResultOptions): ReplayResult {
    return {
      status: options.status,
      deterministic: this.#deterministic,
      startedAtSequence: this.#startedAtSequence,
      currentSequence: this.#currentSequence,
      targetSequence: this.#defaultTargetSequence,
      ...(this.#firstDifference === undefined ? {} : { difference: clone(this.#firstDifference) }),
      ...(this.#nondeterministicFromSequence === undefined
        ? {}
        : { nondeterministicFromSequence: this.#nondeterministicFromSequence }),
      state: this.getState(),
    }
  }
}
