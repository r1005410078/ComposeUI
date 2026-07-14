// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { mountOutputReplayBar } from "./output-replay-bar"
import type { ReplayControllerPort, ReplayControllerState } from "./replay-controller"

function createController(initial: ReplayControllerState): ReplayControllerPort & { publish(state: ReplayControllerState): void } {
  let state = initial
  const listeners = new Set<(next: ReplayControllerState) => void>()
  return {
    start: vi.fn(async () => state),
    stepBackward: vi.fn(async () => state),
    stepForward: vi.fn(async () => state),
    runTo: vi.fn(async () => state),
    verify: vi.fn(async () => state),
    continueBestEffort: vi.fn(async () => state),
    stop: vi.fn(),
    getState: vi.fn(() => state),
    subscribe: vi.fn((listener) => {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }),
    publish(next) {
      state = next
      for (const listener of listeners) listener(state)
    },
  }
}

describe("output replay bar", () => {
  it("stays hidden while replay is inactive", () => {
    const root = document.createElement("div")
    const controller = createController({ active: false, status: "idle", deterministic: true })

    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => undefined,
      onError: vi.fn(),
    })

    expect(root).toHaveProperty("hidden", true)
    expect(root.querySelector("[data-testid='replay-step-backward']")).toBeNull()
    mount.dispose()
  })

  it("renders the contextual summary and labelled controls while active", () => {
    const root = document.createElement("div")
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: true,
      currentSequence: 3,
      targetSequence: 8,
    })

    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => 8,
      onError: vi.fn(),
    })

    const summary = root.querySelector("[data-testid='replay-summary']")!
    expect(summary.getAttribute("role")).toBe("status")
    expect(summary.getAttribute("aria-live")).toBe("polite")
    expect(summary.textContent).toContain("回放至 #8")
    expect(summary.textContent).toContain("当前 #3")
    expect(summary.textContent).toContain("paused")
    expect(summary.textContent).toContain("一致")
    expect(root.querySelector("[aria-label='上一步']")).not.toBeNull()
    expect(root.querySelector("[aria-label='下一步']")).not.toBeNull()
    expect(root.querySelector("[aria-label='运行到选中项']")).not.toBeNull()
    expect(root.querySelector("[aria-label='验证']")).not.toBeNull()
    expect(root.querySelector("[aria-label='停止']")).not.toBeNull()
    expect(root.querySelector("[aria-label='继续回放']")).toBeNull()
    mount.dispose()
  })

  it("shows differences outside the live summary and only offers continue for non-determinism", () => {
    const root = document.createElement("div")
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: false,
      currentSequence: 4,
      targetSequence: 4,
      difference: {
        type: "patch-mismatch",
        sequence: 4,
        path: "forward.created[0]",
        expected: 1n,
        actual: 2n,
      },
    })

    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => undefined,
      onError: vi.fn(),
    })

    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).toContain("回放存在差异")
    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).not.toContain(
      "patch-mismatch",
    )
    expect(root.querySelector("[data-testid='replay-difference']")?.textContent).toContain(
      "patch-mismatch",
    )
    expect(root.querySelector("[aria-label='继续回放']")).not.toBeNull()
    expect(root.querySelector<HTMLButtonElement>("[aria-label='运行到选中项']")?.disabled).toBe(
      true,
    )
    mount.dispose()
  })

  it("reports controller replay failures to the output error surface", () => {
    const root = document.createElement("div")
    const onError = vi.fn()
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: false,
      currentSequence: 4,
      error: "engine unavailable",
    })

    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => undefined,
      onError,
    })

    expect(onError).toHaveBeenCalledWith("回放", expect.objectContaining({ message: "engine unavailable" }))
    mount.dispose()
  })
})
