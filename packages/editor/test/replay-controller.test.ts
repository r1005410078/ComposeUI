// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { EditorSession } from "../src/session"
import {
  EditorSessionReplayAdapter,
  ReplayController,
  type ReplayEngineFactory,
  type ReplayEngineLike,
} from "../src/workspace/replay-controller"

const replayResult = (overrides: Record<string, unknown> = {}) => ({
  status: "completed" as const,
  deterministic: true,
  startedAtSequence: 0,
  currentSequence: 2,
  targetSequence: 2,
  ...overrides,
})

describe("EditorSessionReplayAdapter", () => {
  it("sets expanded ids deterministically without relying on array order", () => {
    const session = new EditorSession()
    session.toggleExpanded("page-2")
    session.toggleExpanded("page-1")
    const adapter = new EditorSessionReplayAdapter(session)

    adapter.setExpanded(["page-3", "page-1"])

    expect(session.getState().expanded).toEqual(["page-1", "page-3"])
  })
})

describe("ReplayController", () => {
  it("controls an isolated engine and publishes typed replay state", async () => {
    const listeners = new Set<(state: unknown) => void>()
    const engine = {
      step: vi.fn(async () => ({
        status: "paused" as const,
        deterministic: false,
        startedAtSequence: 10,
        currentSequence: 12,
        targetSequence: 12,
        difference: {
          type: "patch-mismatch" as const,
          sequence: 12,
          path: "forward.created[0].layout.width",
          expected: 120,
          actual: 999,
        },
      })),
      runTo: vi.fn(async () => ({
        status: "paused" as const,
        deterministic: false,
        startedAtSequence: 10,
        currentSequence: 12,
        targetSequence: 12,
        difference: {
          type: "patch-mismatch" as const,
          sequence: 12,
          path: "forward.created[0].layout.width",
          expected: 120,
          actual: 999,
        },
      })),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => ({ sequence: 12 })),
    }
    const factory: ReplayEngineFactory = vi.fn(async () => engine)
    const controller = new ReplayController({ createEngine: factory })
    controller.subscribe((state) => listeners.forEach((listener) => listener(state)))
    const states: unknown[] = []
    listeners.add((state) => states.push(state))

    await controller.start(12)
    expect(factory).toHaveBeenCalledWith(12)
    expect(engine.runTo).toHaveBeenCalledWith(12)
    expect(controller.getState()).toMatchObject({
      active: true,
      currentSequence: 12,
      deterministic: false,
      difference: {
        type: "patch-mismatch",
        path: "forward.created[0].layout.width",
      },
    })
    expect(states.at(-1)).toMatchObject({ active: true, currentSequence: 12 })

    controller.stop()
    expect(controller.getState()).toMatchObject({ active: false, status: "idle" })
    expect(controller.getState()).not.toHaveProperty("currentSequence")
  })

  it("supports backward, forward, verify, and best-effort controls", async () => {
    const engine = {
      runTo: vi.fn(async () => replayResult()),
      step: vi.fn(async () => replayResult({ status: "paused", currentSequence: 3 })),
      verify: vi.fn(async () => replayResult()),
      continueBestEffort: vi.fn(async () => replayResult({ deterministic: false })),
      getState: vi.fn(() => ({})),
    }
    const createEngine = vi.fn(async () => engine)
    const controller = new ReplayController({ createEngine })

    await controller.start(2)
    await controller.stepBackward()
    await controller.stepForward()
    await controller.verify()
    await controller.continueBestEffort()

    expect(createEngine).toHaveBeenCalledWith(1)
    expect(engine.step).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER)
    expect(engine.verify).toHaveBeenCalledTimes(1)
    expect(engine.continueBestEffort).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ active: true, deterministic: false })
  })

  it("does not resurrect an active replay after stop wins a race", async () => {
    let resolveEngine: ((engine: ReplayEngineLike) => void) | undefined
    const enginePromise = new Promise<ReplayEngineLike>((resolve) => {
      resolveEngine = resolve
    })
    const createEngine = vi.fn(async () => enginePromise)
    const controller = new ReplayController({ createEngine: createEngine as ReplayEngineFactory })
    const pending = controller.start(2)
    controller.stop()
    resolveEngine?.({
      runTo: vi
        .fn(async () => replayResult())
        .mockResolvedValueOnce(replayResult())
        .mockRejectedValueOnce(new Error("run-to failed")),
      step: vi.fn(async () => replayResult()),
      verify: vi.fn(async () => replayResult()),
      continueBestEffort: vi.fn(async () => replayResult()),
      getState: vi.fn(() => ({})),
    })

    await pending
    expect(controller.getState()).toMatchObject({ active: false, status: "idle" })
  })

  it("keeps replay inactive when the engine cannot be created", async () => {
    const controller = new ReplayController({
      createEngine: vi.fn(async () => {
        throw new Error("bundle integrity failed")
      }),
    })

    const state = await controller.start(2)

    expect(state).toMatchObject({
      active: false,
      status: "idle",
      error: "bundle integrity failed",
    })
    expect(state).not.toHaveProperty("currentSequence")
  })

  it("recovers to paused state with an error when an engine command throws", async () => {
    const engine = {
      runTo: vi
        .fn(async () => replayResult())
        .mockResolvedValueOnce(replayResult())
        .mockRejectedValueOnce(new Error("run-to failed")),
      step: vi.fn(async () => replayResult()),
      verify: vi.fn(async () => {
        throw new Error("verify failed")
      }),
      continueBestEffort: vi.fn(async () => {
        throw new Error("best effort failed")
      }),
      getState: vi.fn(() => ({})),
    }
    const controller = new ReplayController({ createEngine: vi.fn(async () => engine) })
    await controller.start(2)

    await controller.runTo(2)
    expect(controller.getState()).toMatchObject({
      active: true,
      status: "paused",
      error: "run-to failed",
    })
    await controller.verify()
    expect(controller.getState()).toMatchObject({
      active: true,
      status: "paused",
      error: "verify failed",
    })
    await controller.continueBestEffort()
    expect(controller.getState()).toMatchObject({
      active: true,
      status: "paused",
      error: "best effort failed",
    })
  })
})
