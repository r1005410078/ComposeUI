import type { OperationCategory, OperationStatus } from "@composeui/operation-log"
import { Filter, MoreHorizontal, Play, RotateCcw, Search, createElement } from "lucide"

export interface OutputToolbarModel {
  readonly levels: readonly OperationStatus[]
  readonly categories: readonly OperationCategory[]
  readonly search: string
  readonly autoScroll: boolean
  readonly selectedSequence?: number
  readonly canReplaySelection: boolean
  readonly busyAction?: string
}

export interface OutputToolbarActions {
  onSearch(search: string): void
  onFilterChange(levels: readonly OperationStatus[], categories: readonly OperationCategory[]): void
  onResetFilters(): void
  onAutoScrollChange(autoScroll: boolean): void
  onImport(): void
  onExport(): void
  onClearView(): void
  onReplaySelected(sequence: number): void
}

export interface OutputToolbarMount {
  update(model: OutputToolbarModel): void
  dispose(): void
}

function actionButton(
  testid: string,
  label: string,
  icon: Parameters<typeof createElement>[0],
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "composeui-editor__output-button"
  button.dataset.testid = testid
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createElement(icon), document.createTextNode(label))
  button.addEventListener("click", onClick)
  return button
}

export function mountOutputToolbar(
  root: HTMLElement,
  actions: OutputToolbarActions,
): OutputToolbarMount {
  root.className = "composeui-editor__output-toolbar"
  root.dataset.testid = "output-toolbar"

  let disposed = false
  let model: OutputToolbarModel = {
    levels: [],
    categories: [],
    search: "",
    autoScroll: true,
    canReplaySelection: false,
  }
  const searchLabel = document.createElement("label")
  searchLabel.className = "composeui-editor__output-search"
  searchLabel.append(createElement(Search))
  const searchInput = document.createElement("input")
  searchInput.type = "search"
  searchInput.placeholder = "搜索操作日志"
  searchInput.setAttribute("aria-label", "搜索操作日志")
  searchInput.addEventListener("input", () => actions.onSearch(searchInput.value))
  searchLabel.append(searchInput)

  const filter = actionButton("output-filter-trigger", "筛选", Filter, () => undefined)
  const autoScroll = actionButton("output-auto-scroll", "自动滚动", RotateCcw, () => {
    actions.onAutoScrollChange(!model.autoScroll)
  })
  const more = actionButton("output-more-trigger", "更多操作", MoreHorizontal, () => undefined)
  const replayHost = document.createElement("span")
  replayHost.dataset.testid = "output-replay-host"
  root.replaceChildren(searchLabel, filter, autoScroll, more, replayHost)

  const render = (): void => {
    searchInput.value = model.search
    autoScroll.setAttribute("aria-pressed", String(model.autoScroll))
    autoScroll.disabled = model.busyAction === "auto-scroll"
    replayHost.replaceChildren()
    if (!model.canReplaySelection || model.selectedSequence === undefined) return
    const sequence = model.selectedSequence
    const replay = actionButton("output-replay", "回放到此处", Play, () => {
      actions.onReplaySelected(sequence)
    })
    replay.disabled = model.busyAction === "replay"
    replayHost.append(replay)
  }

  render()
  return {
    update(nextModel) {
      if (disposed) return
      model = nextModel
      render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    },
  }
}
