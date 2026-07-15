import { canonicalizeDocument, createEditor } from "@composeui/core"
import type { Editor, PageDocument } from "@composeui/core"
import { hashCanonical } from "../canonical"
import type { OperationEvent } from "../events"
import type { ValidatedLogBundle } from "../bundle"
import { isValidatedLogBundle } from "../bundle"
import { builtinReplayHandlers } from "./builtin-handlers"
import { ReplayHandlerRegistry } from "./registry"
import type {
  ReplayDifference,
  ReplayHandler,
  ReplayHandlerContext,
  ReplaySessionPort,
  ReplayWorkspacePort,
} from "./types"

export interface ReplayEngineCreateOptions {
  bundle: ValidatedLogBundle
  targetSequence?: number
  createSession: (initialState: unknown) => ReplaySessionPort | Promise<ReplaySessionPort>
  createWorkspace?: (initialState: unknown) => ReplayWorkspacePort | Promise<ReplayWorkspacePort>
  createEditor?: (document: PageDocument) => Editor
  approvedHandlers?: ReadonlyMap<string, ReplayHandler> | Readonly<Record<string, ReplayHandler>>
}

export type ReplayResultStatus = "completed" | "paused"

export interface ReplayState {
  sequence: number
  document: PageDocument
  session: unknown
  workspace: unknown
}

export interface ReplayResult {
  status: ReplayResultStatus
  deterministic: boolean
  startedAtSequence: number
  currentSequence: number
  targetSequence: number
  difference?: ReplayDifference
  nondeterministicFromSequence?: number
  state?: ReplayState
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function workspaceLayoutState(layout: unknown): Record<string, unknown> | undefined {
  if (!isRecord(layout)) return undefined
  return isRecord(layout.layout) ? layout.layout : layout
}

function workspacePanelIds(layout: unknown): string[] {
  const panels = workspaceLayoutState(layout)?.panels
  if (!Array.isArray(panels)) return []
  return panels.filter((panelId): panelId is string => typeof panelId === "string")
}

function workspaceActivePanelId(layout: unknown): string | undefined {
  const activePanelId = workspaceLayoutState(layout)?.activePanelId
  return typeof activePanelId === "string" ? activePanelId : undefined
}

function createInMemoryWorkspace(initialState: unknown): ReplayWorkspacePort {
  let layout = clone(initialState)
  const panels = new Set(workspacePanelIds(layout))
  let activePanelId = workspaceActivePanelId(layout)
  let hasPanelOverlay = false

  const applyLayout = (nextLayout: unknown): void => {
    layout = clone(nextLayout)
    panels.clear()
    for (const panelId of workspacePanelIds(layout)) panels.add(panelId)
    activePanelId = workspaceActivePanelId(layout)
    hasPanelOverlay = false
  }

  const snapshot = (): unknown => {
    if (layout === undefined && panels.size === 0 && activePanelId === undefined) return undefined
    if (!hasPanelOverlay) return clone(layout)
    return {
      layout: clone(layout),
      panels: [...panels],
      ...(activePanelId === undefined ? {} : { activePanelId }),
    }
  }
  return {
    openPanel(panelId) {
      panels.add(panelId)
      hasPanelOverlay = true
    },
    closePanel(panelId) {
      panels.delete(panelId)
      if (activePanelId === panelId) activePanelId = undefined
      hasPanelOverlay = true
    },
    activatePanel(panelId) {
      panels.add(panelId)
      activePanelId = panelId
      hasPanelOverlay = true
    },
    applyLayout(nextLayout) {
      applyLayout(nextLayout)
    },
    resetLayout(nextLayout) {
      applyLayout(nextLayout)
    },
    getState: snapshot,
  }
}

/**
 * Replays a validated bundle in a newly-created core/session runtime.
 * No host adapters are accepted by this class; handlers always receive disabled side effects.
 */
export class ReplayEngine {
  readonly #editor: Editor | undefined
  readonly #session: ReplaySessionPort | undefined
  readonly #workspace: ReplayWorkspacePort | undefined
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
    if (!isValidatedLogBundle(options.bundle)) throw new Error("REPLAY_BUNDLE_NOT_VALIDATED")
    if (!Number.isSafeInteger(options.targetSequence ?? 0) || (options.targetSequence ?? 0) < 0) {
      throw new Error("INVALID_REPLAY_TARGET_SEQUENCE")
    }
    const targetSequence = options.targetSequence ?? Number.MAX_SAFE_INTEGER
    const checkpoints = options.bundle.checkpoints.filter(
      (checkpoint) =>
        checkpoint.sequence < targetSequence || (targetSequence === 0 && checkpoint.sequence === 0),
    )
    const sortedCheckpoints = sortBySequence(checkpoints)
    const checkpoint = sortedCheckpoints.at(-1) ?? options.bundle.checkpoints[0]
    const registry = new ReplayHandlerRegistry()
    const approvedEntries = [...handlerEntries(options.approvedHandlers)]
    const approvedTypes = new Set(approvedEntries.map(([type]) => type))
    for (const [type, handler] of Object.entries(builtinReplayHandlers))
      if (!approvedTypes.has(type)) registry.register(type, handler)
    for (const [type, handler] of approvedEntries) registry.register(type, handler)
    if (sortedCheckpoints.length === 0) {
      return new ReplayEngine(
        options.bundle,
        undefined,
        undefined,
        undefined,
        registry,
        targetSequence,
        targetSequence,
        {
          type: "schema-incompatible",
          sequence: targetSequence,
          version: options.bundle.manifest.schemaVersion,
        },
      )
    }
    if (checkpoint === undefined) throw new Error("REPLAY_CHECKPOINT_NOT_FOUND")

    const createIsolatedEditor =
      options.createEditor ?? ((initialDocument: PageDocument) => createEditor(initialDocument))
    const editor = createIsolatedEditor(clone(checkpoint.document))
    try {
      const session = await options.createSession(clone(checkpoint.sessionState))
      try {
        const workspace =
          options.createWorkspace === undefined
            ? createInMemoryWorkspace(checkpoint.workspaceState)
            : await options.createWorkspace(clone(checkpoint.workspaceState))
        return new ReplayEngine(
          options.bundle,
          editor,
          session,
          workspace,
          registry,
          checkpoint.sequence,
          targetSequence,
        )
      } catch (error) {
        return new ReplayEngine(
          options.bundle,
          editor,
          session,
          undefined,
          registry,
          checkpoint.sequence,
          targetSequence,
          {
            type: "workspace-error",
            sequence: checkpoint.sequence,
            eventType: "workspace.create",
            message: errorMessage(error),
          },
        )
      }
    } catch (error) {
      return new ReplayEngine(
        options.bundle,
        editor,
        undefined,
        undefined,
        registry,
        checkpoint.sequence,
        targetSequence,
        {
          type: "session-error",
          sequence: checkpoint.sequence,
          eventType: "session.create",
          message: errorMessage(error),
        },
      )
    }
  }

  private constructor(
    bundle: ValidatedLogBundle,
    editor: Editor | undefined,
    session: ReplaySessionPort | undefined,
    workspace: ReplayWorkspacePort | undefined,
    registry: ReplayHandlerRegistry,
    startedAtSequence: number,
    targetSequence: number,
    initialDifference?: ReplayDifference,
  ) {
    this.#editor = editor
    this.#session = session
    this.#workspace = workspace
    this.#registry = registry
    this.#startedAtSequence = startedAtSequence
    this.#currentSequence = startedAtSequence
    this.#firstDifference = initialDifference
    this.#paused = initialDifference !== undefined
    this.#deterministic = initialDifference === undefined
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
    if (this.#paused && !this.#bestEffort) return this.#result({ status: "paused" }, targetSequence)
    if (
      this.#editor === undefined ||
      this.#session === undefined ||
      this.#workspace === undefined
    ) {
      return this.#result({ status: "paused" }, targetSequence)
    }
    const event = this.#nextEvent(targetSequence)
    if (event === undefined) return this.#result({ status: "completed" }, targetSequence)
    this.#eventIndex += 1
    this.#currentSequence = eventSequence(event)
    const resolution = this.#registry.resolve(event.type, event.sequence)
    let difference: ReplayDifference | undefined
    if (!resolution.ok) difference = resolution.difference
    else {
      const context: ReplayHandlerContext = {
        editor: this.#editor,
        session: this.#session,
        workspace: this.#workspace,
        sideEffects: "disabled",
      }
      try {
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
      } catch (error) {
        difference = {
          type:
            event.category === "session"
              ? "session-error"
              : event.category === "workspace"
                ? "workspace-error"
                : "handler-error",
          sequence: event.sequence,
          eventType: event.type,
          message: errorMessage(error),
        }
      }
    }

    if (difference !== undefined) {
      this.#deterministic = false
      this.#firstDifference ??= clone(difference)
      this.#nondeterministicFromSequence ??= event.sequence
      if (!this.#bestEffort) {
        this.#paused = true
        return this.#result({ status: "paused", difference }, targetSequence)
      }
    }
    return this.#result(
      {
        status: this.#nextEvent(targetSequence) === undefined ? "completed" : "paused",
      },
      targetSequence,
    )
  }

  async runTo(targetSequence: number): Promise<ReplayResult> {
    if (!Number.isSafeInteger(targetSequence) || targetSequence < this.#startedAtSequence) {
      throw new Error("INVALID_REPLAY_TARGET_SEQUENCE")
    }
    if (this.#paused && !this.#bestEffort) return this.#result({ status: "paused" }, targetSequence)
    while (!this.#paused || this.#bestEffort) {
      const event = this.#nextEvent(targetSequence)
      if (event === undefined) break
      await this.step(targetSequence)
      if (this.#paused && !this.#bestEffort)
        return this.#result({ status: "paused" }, targetSequence)
    }
    return this.#result(
      {
        status: this.#currentSequence >= targetSequence ? "completed" : "paused",
      },
      targetSequence,
    )
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
    if (
      this.#editor === undefined ||
      this.#session === undefined ||
      this.#workspace === undefined
    ) {
      throw new Error("REPLAY_STATE_UNAVAILABLE")
    }
    return {
      sequence: this.#currentSequence,
      document: clone(snapshotDocument(this.#editor)),
      session: clone(this.#session.getState()),
      workspace: this.#workspaceState(),
    }
  }

  #nextEvent(targetSequence: number): OperationEvent | undefined {
    const event = this.#events[this.#eventIndex]
    return event !== undefined && event.sequence <= targetSequence ? event : undefined
  }

  #workspaceState(): unknown {
    try {
      return clone(this.#workspace!.getState())
    } catch (error) {
      throw new ReplayWorkspaceStateError(errorMessage(error))
    }
  }

  #result(options: InternalResultOptions, targetSequence: number): ReplayResult {
    let state: ReplayState | undefined
    try {
      state = this.getState()
    } catch (error) {
      if (this.#firstDifference === undefined) {
        this.#recordDifference({
          type: error instanceof ReplayWorkspaceStateError ? "workspace-error" : "session-error",
          sequence: this.#currentSequence,
          eventType:
            error instanceof ReplayWorkspaceStateError ? "workspace.state" : "session.state",
          message: errorMessage(error),
        })
      }
    }
    return {
      status: options.status,
      deterministic: this.#deterministic,
      startedAtSequence: this.#startedAtSequence,
      currentSequence: this.#currentSequence,
      targetSequence,
      ...(this.#firstDifference === undefined ? {} : { difference: clone(this.#firstDifference) }),
      ...(this.#nondeterministicFromSequence === undefined
        ? {}
        : { nondeterministicFromSequence: this.#nondeterministicFromSequence }),
      ...(state === undefined ? {} : { state }),
    }
  }

  #recordDifference(difference: ReplayDifference): void {
    this.#deterministic = false
    this.#firstDifference ??= clone(difference)
    this.#nondeterministicFromSequence ??= difference.sequence
  }
}

class ReplayWorkspaceStateError extends Error {}
