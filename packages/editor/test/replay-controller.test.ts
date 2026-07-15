// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEmptyDocument } from "@composeui/core"
import type { ReplayState } from "@composeui/operation-log"
import { EditorSession } from "../src/session"
import {
  EditorSessionReplayAdapter,
  ReplayController,
  type ReplayEngineFactory,
  type ReplayEngineLike,
} from "../src/workspace/replay-controller"

const replayState = (sequence: number): ReplayState => ({
  sequence,
  document: createEmptyDocument({ documentId: "document-1", pageId: "page-1" }),
  session: {},
  workspace: {},
})

const replayResult = (overrides: Record<string, unknown> = {}) => ({
  status: "completed" as const,
  deterministic: true,
  startedAtSequence: 0,
  currentSequence: 2,
  targetSequence: 2,
  state: replayState(2),
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
  it("publishes its checkpoint and each auto-playback frame", async () => {
    const waits: Array<() => void> = []
    const wait = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          waits.push(resolve)
        }),
    )
    const engine = {
      step: vi
        .fn()
        .mockResolvedValueOnce(
          replayResult({
            status: "paused",
            currentSequence: 1,
            targetSequence: 2,
            state: replayState(1),
          }),
        )
        .mockResolvedValueOnce(replayResult({ state: replayState(2) })),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(0)),
    }
    const controller = new ReplayController({ createEngine: vi.fn(async () => engine), wait })
    const frames: number[] = []
    controller.subscribe((state) => {
      if (state.frame !== undefined) frames.push(state.frame.sequence)
    })

    const state = await controller.start(2)
    expect(state).toMatchObject({ active: true, status: "running", currentSequence: 0 })
    expect(frames).toEqual([0])
    expect(engine.step).not.toHaveBeenCalled()

    waits.shift()?.()
    await vi.waitFor(() => expect(frames).toEqual([0, 1]))
    expect(controller.getState()).toMatchObject({ status: "running", currentSequence: 1 })

    waits.shift()?.()
    await vi.waitFor(() => expect(controller.getState().status).toBe("completed"))
    expect(frames).toEqual([0, 1, 2])
    expect(engine.step).toHaveBeenCalledTimes(2)
  })

  it("pauses auto-playback on a difference without taking another step", async () => {
    const difference = {
      type: "patch-mismatch" as const,
      sequence: 1,
      path: "forward.created[0].layout.width",
      expected: 120,
      actual: 999,
    }
    const engine = {
      step: vi.fn(async () =>
        replayResult({
          status: "paused",
          deterministic: false,
          currentSequence: 1,
          targetSequence: 2,
          difference,
          state: replayState(1),
        }),
      ),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(0)),
    }
    const controller = new ReplayController({
      createEngine: vi.fn(async () => engine),
      wait: async () => {},
    })

    await controller.start(2)
    await vi.waitFor(() => expect(controller.getState().status).toBe("paused"))
    expect(controller.getState()).toMatchObject({ frame: { sequence: 1 }, difference })
    expect(engine.step).toHaveBeenCalledTimes(1)
  })

  it("pauses a pending wait and resumes playback with the same engine", async () => {
    const waits: Array<() => void> = []
    const wait = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          waits.push(resolve)
        }),
    )
    const engine = {
      step: vi.fn(async () =>
        replayResult({
          status: "paused",
          currentSequence: 1,
          targetSequence: 2,
          state: replayState(1),
        }),
      ),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(0)),
    }
    const createEngine = vi.fn(async () => engine)
    const controller = new ReplayController({ createEngine, wait })

    await controller.start(2)
    controller.pause()
    waits.shift()?.()
    await Promise.resolve()
    expect(engine.step).not.toHaveBeenCalled()

    await controller.resume()
    expect(createEngine).toHaveBeenCalledTimes(1)
    waits.shift()?.()
    await vi.waitFor(() => expect(controller.getState().frame).toMatchObject({ sequence: 1 }))
    controller.pause()

    expect(controller.getState()).toMatchObject({
      active: true,
      status: "paused",
      frame: { sequence: 1 },
    })
  })

  it("ignores a late auto-playback step after stop", async () => {
    let resolveStep: ((result: ReturnType<typeof replayResult>) => void) | undefined
    const engine = {
      step: vi.fn(
        () =>
          new Promise<ReturnType<typeof replayResult>>((resolve) => {
            resolveStep = resolve
          }),
      ),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(0)),
    }
    const controller = new ReplayController({
      createEngine: vi.fn(async () => engine),
      wait: async () => {},
    })

    await controller.start(2)
    await vi.waitFor(() => expect(engine.step).toHaveBeenCalledOnce())
    controller.stop()
    resolveStep?.(replayResult({ currentSequence: 1, targetSequence: 2, state: replayState(1) }))
    await Promise.resolve()

    expect(controller.getState()).toEqual({ active: false, status: "idle", deterministic: true })
  })

  it("completes auto-playback when the engine has no event at the target", async () => {
    const waits: Array<() => void> = []
    const engine = {
      step: vi.fn(async () =>
        replayResult({
          currentSequence: 1,
          targetSequence: 2,
          state: replayState(1),
        }),
      ),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(0)),
    }
    const controller = new ReplayController({
      createEngine: vi.fn(async () => engine),
      wait: () =>
        new Promise<void>((resolve) => {
          waits.push(resolve)
        }),
    })

    await controller.start(2)
    waits.shift()?.()
    await vi.waitFor(() => expect(controller.getState().status).toBe("completed"))
    expect(engine.step).toHaveBeenCalledTimes(1)
  })

  it("preserves its confirmed frame when a difference result has no snapshot", async () => {
    const engine = {
      step: vi.fn(async () =>
        replayResult({
          status: "paused",
          deterministic: false,
          currentSequence: 1,
          targetSequence: 1,
          difference: {
            type: "patch-mismatch" as const,
            sequence: 1,
            path: "forward.created[0].layout.width",
            expected: 120,
            actual: 999,
          },
          state: undefined,
        }),
      ),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(0)),
    }
    const controller = new ReplayController({
      createEngine: vi.fn(async () => engine),
      wait: async () => {},
    })

    await controller.start(1)
    await vi.waitFor(() => expect(controller.getState().status).toBe("paused"))
    expect(controller.getState()).toMatchObject({
      frame: { sequence: 0 },
      difference: { sequence: 1 },
    })
  })

  it("completes without a timer when its checkpoint is beyond the target", async () => {
    const wait = vi.fn(async () => {})
    const engine = {
      step: vi.fn(),
      runTo: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(2)),
    }
    const controller = new ReplayController({ createEngine: vi.fn(async () => engine), wait })

    const state = await controller.start(1)

    expect(state).toMatchObject({ status: "completed", frame: { sequence: 2 } })
    expect(wait).not.toHaveBeenCalled()
    expect(engine.step).not.toHaveBeenCalled()
  })

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
      getState: vi.fn(() => replayState(12)),
    }
    const factory: ReplayEngineFactory = vi.fn(async () => engine)
    const controller = new ReplayController({ createEngine: factory, wait: async () => {} })
    controller.subscribe((state) => listeners.forEach((listener) => listener(state)))
    const states: unknown[] = []
    listeners.add((state) => states.push(state))

    await controller.start(12)
    expect(factory).toHaveBeenCalledWith(12)
    expect(engine.runTo).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      active: true,
      currentSequence: 12,
      deterministic: true,
      frame: { sequence: 12 },
    })
    expect(states.at(-1)).toMatchObject({
      active: true,
      currentSequence: 12,
      frame: { sequence: 12 },
    })

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
      getState: vi.fn(() => replayState(2)),
    }
    const createEngine = vi.fn(async () => engine)
    const controller = new ReplayController({ createEngine, wait: async () => {} })

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

  it("preserves visible frames for manual backward and forward steps", async () => {
    const engine = {
      runTo: vi.fn(async () => replayResult({ currentSequence: 1, state: replayState(1) })),
      step: vi.fn(async () =>
        replayResult({ status: "paused", currentSequence: 2, state: replayState(2) }),
      ),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(2)),
    }
    const controller = new ReplayController({
      createEngine: vi.fn(async () => engine),
      wait: async () => {},
    })

    await controller.start(2)
    await controller.stepBackward()
    expect(controller.getState()).toMatchObject({ status: "paused", frame: { sequence: 1 } })
    await controller.stepForward()

    expect(controller.getState()).toMatchObject({ status: "paused", frame: { sequence: 2 } })
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
      runTo: vi.fn(async () => {
        throw new Error("run-to failed")
      }),
      step: vi.fn(async () => replayResult()),
      verify: vi.fn(async () => replayResult()),
      continueBestEffort: vi.fn(async () => replayResult()),
      getState: vi.fn(() => replayState(2)),
    })

    await pending
    expect(controller.getState()).toMatchObject({ active: false, status: "idle" })
  })

  it("clears the first replay frame and error when a replacement engine cannot be created", async () => {
    const engine = {
      runTo: vi.fn(async () => {
        throw new Error("first replay failed")
      }),
      step: vi.fn(),
      verify: vi.fn(),
      continueBestEffort: vi.fn(),
      getState: vi.fn(() => replayState(2)),
    }
    const controller = new ReplayController({
      createEngine: vi
        .fn(async () => engine)
        .mockResolvedValueOnce(engine)
        .mockRejectedValueOnce(new Error("bundle integrity failed")),
    })

    await controller.start(2)
    await controller.runTo(2)
    expect(controller.getState()).toMatchObject({
      frame: { sequence: 2 },
      error: "first replay failed",
    })

    const state = await controller.start(3)

    expect(state).toMatchObject({
      active: false,
      status: "idle",
      error: "bundle integrity failed",
    })
    expect(state).not.toHaveProperty("currentSequence")
    expect(state).not.toHaveProperty("frame")
  })

  it("recovers to paused state with an error when an engine command throws", async () => {
    const engine = {
      runTo: vi.fn(async () => {
        throw new Error("run-to failed")
      }),
      step: vi.fn(async () => replayResult()),
      verify: vi.fn(async () => {
        throw new Error("verify failed")
      }),
      continueBestEffort: vi.fn(async () => {
        throw new Error("best effort failed")
      }),
      getState: vi.fn(() => replayState(2)),
    }
    const controller = new ReplayController({
      createEngine: vi.fn(async () => engine),
      wait: async () => {},
    })
    await controller.start(2)

    await controller.runTo(2)
    expect(controller.getState()).toMatchObject({
      active: true,
      status: "paused",
      error: "run-to failed",
      frame: { sequence: 2 },
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
