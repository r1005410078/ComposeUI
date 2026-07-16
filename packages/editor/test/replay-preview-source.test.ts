import { describe, expect, it, vi } from "vitest"
import { createEmptyDocument } from "@composeui/core"
import type {
  ReplayControllerPort,
  ReplayControllerState,
} from "../src/workspace/replay-controller"
import { createReplayPreviewSource } from "../src/workspace/replay-preview-source"

function createController(initialState: ReplayControllerState): ReplayControllerPort & {
  publish(state: ReplayControllerState): void
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let state = structuredClone(initialState)
  const listeners = new Set<(state: ReplayControllerState) => void>()
  const unsubscribe = vi.fn(() => undefined)
  return {
    start: vi.fn(async () => state),
    pause: vi.fn(() => state),
    resume: vi.fn(async () => state),
    stepBackward: vi.fn(async () => state),
    stepForward: vi.fn(async () => state),
    runTo: vi.fn(async () => state),
    verify: vi.fn(async () => state),
    continueBestEffort: vi.fn(async () => state),
    stop: vi.fn(),
    getState: vi.fn(() => structuredClone(state)),
    subscribe: vi.fn((listener) => {
      listeners.add(listener)
      listener(structuredClone(state))
      return () => {
        listeners.delete(listener)
        unsubscribe()
      }
    }),
    publish(next) {
      state = structuredClone(next)
      for (const listener of listeners) listener(structuredClone(state))
    },
    unsubscribe,
  }
}

describe("createReplayPreviewSource", () => {
  it("projects an active frame and then releases the preview when replay stops", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: true,
      currentSequence: 2,
      targetSequence: 4,
      frame: {
        sequence: 2,
        document,
        session: {
          viewport: { x: 12, y: 24, zoom: 1.5 },
          selection: ["node-1"],
          expanded: ["page-1"],
          hoveredId: "node-1",
          gridVisible: false,
          gridSize: 16,
          snapEnabled: false,
          interactionMode: "pan",
        },
        workspace: {},
      },
    })
    const source = createReplayPreviewSource(controller)
    const frames: ReturnType<typeof source.getState>[] = []
    source.subscribe((frame) => frames.push(frame))

    expect(frames.at(-1)).toMatchObject({
      active: true,
      document,
      session: {
        viewport: { x: 12, y: 24, zoom: 1.5 },
        selection: ["node-1"],
        expanded: ["page-1"],
        hoveredId: "node-1",
        gridVisible: false,
        gridSize: 16,
        snapEnabled: false,
        interactionMode: "pan",
      },
      currentSequence: 2,
      targetSequence: 4,
    })

    controller.publish({ active: false, status: "idle", deterministic: true })

    expect(frames.at(-1)).toEqual({ active: false })
  })

  it("defaults missing gridSize and snapEnabled for old checkpoints", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: true,
      frame: {
        sequence: 1,
        document,
        session: {
          viewport: { x: 0, y: 0, zoom: 1 },
          selection: [],
          expanded: [],
          hoveredId: null,
          gridVisible: true,
          interactionMode: "select",
        },
        workspace: {},
      },
    })
    const source = createReplayPreviewSource(controller)

    expect(source.getState().session).toEqual({
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      expanded: [],
      hoveredId: null,
      gridVisible: true,
      gridSize: 8,
      snapEnabled: true,
      interactionMode: "select",
    })
  })

  it("omits malformed replay session state and returns isolated snapshots", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: true,
      frame: {
        sequence: 1,
        document,
        session: {
          viewport: { x: 0, y: 0, zoom: 0 },
          selection: ["node-1"],
          expanded: ["page-1"],
          hoveredId: null,
          gridVisible: true,
          interactionMode: "select",
        },
        workspace: {},
      },
    })
    const source = createReplayPreviewSource(controller)

    const first = source.getState()
    expect(first).toEqual({ active: true, document })
    first.document!.rootPageId = "mutated"

    expect(source.getState()).toEqual({ active: true, document })
  })

  it("locks the canvas before the first frame and stops emitting after disposal", () => {
    const controller = createController({ active: true, status: "running", deterministic: true })
    const source = createReplayPreviewSource(controller)
    const listener = vi.fn()
    source.subscribe(listener)

    expect(source.getState()).toEqual({ active: true })
    expect(listener).toHaveBeenCalledOnce()

    source.dispose()
    source.dispose()
    controller.publish({ active: false, status: "idle", deterministic: true })

    expect(controller.unsubscribe).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
  })
})
