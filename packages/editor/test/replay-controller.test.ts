// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { EditorSession } from "../src/session"
import {
  EditorSessionReplayAdapter,
  ReplayController,
  type ReplayEngineFactory,
} from "../src/workspace/replay-controller"

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
})
