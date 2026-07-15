import {
  BadgeCheck,
  FastForward,
  Pause,
  Play,
  Square,
  StepBack,
  StepForward,
  createElement,
} from "lucide"
import type { ReplayControllerPort } from "./replay-controller"
import { safeText } from "./output-value-format"

export interface OutputReplayBarModel {
  readonly busy: boolean
}

export interface OutputReplayBarMount {
  update(model: OutputReplayBarModel): void
  dispose(): void
}

export interface OutputReplayBarOptions {
  readonly controller: ReplayControllerPort
  readonly getSelectedSequence: () => number | undefined
  readonly onError: (label: string, error: unknown) => void
  readonly model: OutputReplayBarModel
}

function textElement(
  tag: keyof HTMLElementTagNameMap,
  className: string,
  value: string,
): HTMLElement {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = value
  return element
}

export function mountOutputReplayBar(
  root: HTMLElement,
  options: OutputReplayBarOptions,
): OutputReplayBarMount {
  root.className = "composeui-editor__output-replay"
  root.dataset.testid = "replay-host"
  let state = options.controller.getState()
  let model = options.model
  let disposed = false
  let reportedError: string | undefined

  const render = (): void => {
    root.hidden = !state.active
    if (!state.active) {
      root.replaceChildren()
      return
    }

    const summary = textElement(
      "p",
      "composeui-editor__output-replay-summary",
      [
        `回放至 #${state.targetSequence ?? "-"}`,
        `当前 #${state.currentSequence ?? "-"}`,
        `状态：${state.status}`,
        state.deterministic ? "一致" : "回放存在差异",
      ].join("，"),
    )
    summary.dataset.testid = "replay-summary"
    summary.setAttribute("role", "status")
    summary.setAttribute("aria-live", "polite")

    const controls = document.createElement("div")
    controls.className = "composeui-editor__output-replay-controls"
    const action = (
      testid: string,
      label: string,
      icon: Parameters<typeof createElement>[0],
      iconName: string,
      handler: () => void | Promise<unknown>,
      disabled = model.busy,
    ): HTMLButtonElement => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "composeui-editor__output-button"
      button.dataset.testid = testid
      button.dataset.icon = iconName
      button.title = label
      button.setAttribute("aria-label", label)
      button.disabled = disabled
      button.append(createElement(icon), document.createTextNode(label))
      button.addEventListener("click", () => {
        try {
          void Promise.resolve(handler()).catch((error) => options.onError(label, error))
        } catch (error) {
          options.onError(label, error)
        }
      })
      return button
    }

    if (state.status === "running") {
      controls.append(
        action("replay-pause", "暂停", Pause, "pause", () => {
          void options.controller.pause()
        }),
        action("replay-stop", "停止", Square, "square", () => options.controller.stop(), false),
      )
    } else {
      if (state.status === "paused" && state.difference === undefined) {
        controls.append(
          action("replay-resume", "继续自动播放", Play, "play", () => options.controller.resume()),
        )
      }
      controls.append(
        action("replay-step-backward", "上一步", StepBack, "step-back", () =>
          options.controller.stepBackward(),
        ),
        action("replay-step-forward", "下一步", StepForward, "step-forward", () =>
          options.controller.stepForward(),
        ),
        action("replay-verify", "验证", BadgeCheck, "badge-check", () =>
          options.controller.verify(),
        ),
      )
      if (!state.deterministic || state.difference !== undefined) {
        controls.append(
          action("replay-continue", "忽略差异并继续", FastForward, "fast-forward", () =>
            options.controller.continueBestEffort(),
          ),
        )
      }
      controls.append(
        action("replay-stop", "停止", Square, "square", () => options.controller.stop(), false),
      )
    }

    const children: Node[] = [summary, controls]
    if (state.difference !== undefined) {
      const difference = state.difference
      const detail = textElement(
        "pre",
        "composeui-editor__output-replay-difference",
        [
          `type: ${difference.type}`,
          `sequence: ${difference.sequence}`,
          ...("path" in difference ? [`path: ${difference.path}`] : []),
          ...("expected" in difference ? [`expected: ${safeText(difference.expected)}`] : []),
          ...("actual" in difference ? [`actual: ${safeText(difference.actual)}`] : []),
        ].join("\n"),
      )
      detail.dataset.testid = "replay-difference"
      children.push(detail)
    }
    root.replaceChildren(...children)
  }

  const unsubscribe = options.controller.subscribe((nextState) => {
    state = nextState
    if (nextState.error === undefined) {
      reportedError = undefined
    } else if (nextState.error !== reportedError) {
      reportedError = nextState.error
      options.onError("回放", new Error(nextState.error))
    }
    if (!disposed) render()
  })
  render()

  return {
    update(nextModel) {
      model = nextModel
      if (!disposed) render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      root.replaceChildren()
    },
  }
}
