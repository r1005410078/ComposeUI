// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { mountOutputReplayBar } from "../src/workspace/output-replay-bar"
import type {
  ReplayControllerPort,
  ReplayControllerState,
} from "../src/workspace/replay-controller"

function createController(
  initial: ReplayControllerState,
): ReplayControllerPort & { publish(state: ReplayControllerState): void } {
  let state = initial
  const listeners = new Set<(next: ReplayControllerState) => void>()
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
      model: { busy: false },
    })

    expect(root).toHaveProperty("hidden", true)
    expect(root.querySelector("[data-testid='replay-step-backward']")).toBeNull()
    mount.dispose()
  })

  it("renders the contextual summary and paused controls while active", () => {
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
      model: { busy: false },
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
    expect(root.querySelector("[data-testid='replay-resume']")).not.toBeNull()
    expect(root.querySelector("[aria-label='验证']")).not.toBeNull()
    expect(root.querySelector("[aria-label='停止']")).not.toBeNull()
    expect(root.querySelector("[data-testid='replay-run-to']")).toBeNull()
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
      model: { busy: false },
    })

    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).toContain(
      "回放存在差异",
    )
    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).not.toContain(
      "patch-mismatch",
    )
    expect(root.querySelector("[data-testid='replay-difference']")?.textContent).toContain(
      "patch-mismatch",
    )
    expect(root.querySelector("[aria-label='忽略差异并继续']")).not.toBeNull()
    expect(root.querySelector("[data-testid='replay-resume']")).toBeNull()
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
      model: { busy: false },
    })

    expect(onError).toHaveBeenCalledWith(
      "回放",
      expect.objectContaining({ message: "engine unavailable" }),
    )
    mount.dispose()
  })

  it("stops replay synchronously so a stale next action cannot run after it", () => {
    const root = document.createElement("div")
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: true,
      currentSequence: 3,
      targetSequence: 8,
    })
    controller.stop.mockImplementation(() => {
      controller.publish({ active: false, status: "idle", deterministic: true })
    })
    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => 8,
      onError: vi.fn(),
      model: { busy: false },
    })

    root.querySelector<HTMLButtonElement>("[data-testid='replay-stop']")!.click()

    expect(controller.stop).toHaveBeenCalledOnce()
    expect(root.hidden).toBe(true)
    expect(root.querySelector("[data-testid='replay-step-forward']")).toBeNull()
    mount.dispose()
  })

  it("shows pause while playing and resume while paused", () => {
    const root = document.createElement("div")
    const controller = createController({ active: true, status: "running", deterministic: true })
    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => 8,
      onError: vi.fn(),
      model: { busy: false },
    })

    const pause = root.querySelector<HTMLButtonElement>("[data-testid='replay-pause']")!
    expect(pause.title).toBe("暂停")
    expect(pause.getAttribute("data-icon")).toBe("pause")
    expect(root.querySelector("[data-testid='replay-step-forward']")).toBeNull()
    pause.click()
    expect(controller.pause).toHaveBeenCalledOnce()

    controller.publish({ active: true, status: "paused", deterministic: true })
    const resume = root.querySelector<HTMLButtonElement>("[data-testid='replay-resume']")!
    expect(resume.title).toBe("继续自动播放")
    expect(resume.getAttribute("data-icon")).toBe("play")
    resume.click()
    expect(controller.resume).toHaveBeenCalledOnce()
    mount.dispose()
  })

  it("invokes each enabled paused control and keeps stop available while busy", async () => {
    const root = document.createElement("div")
    const controller = createController({
      active: true,
      status: "paused",
      deterministic: false,
      currentSequence: 3,
      targetSequence: 8,
    })
    const mount = mountOutputReplayBar(root, {
      controller,
      getSelectedSequence: () => 8,
      onError: vi.fn(),
      model: { busy: false },
    })

    root.querySelector<HTMLButtonElement>("[data-testid='replay-step-backward']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='replay-step-forward']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='replay-resume']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='replay-verify']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='replay-continue']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='replay-stop']")!.click()
    await vi.waitFor(() => {
      expect(controller.stepBackward).toHaveBeenCalledOnce()
      expect(controller.stepForward).toHaveBeenCalledOnce()
      expect(controller.resume).toHaveBeenCalledOnce()
      expect(controller.verify).toHaveBeenCalledOnce()
      expect(controller.continueBestEffort).toHaveBeenCalledOnce()
      expect(controller.stop).toHaveBeenCalledOnce()
    })
    expect(root.querySelector("[data-testid='replay-continue']")?.getAttribute("data-icon")).toBe(
      "fast-forward",
    )

    mount.update({ busy: true })
    expect(root.querySelector<HTMLButtonElement>("[data-testid='replay-resume']")?.disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>("[data-testid='replay-stop']")?.disabled).toBe(false)
    mount.dispose()
  })
})
