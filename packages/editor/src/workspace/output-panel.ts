import type { OperationCategory, OperationEvent, OperationStatus } from "@composeui/operation-log"
import { Check, Play, RotateCcw, Trash2, createElement } from "lucide"
import { formatOperation } from "./operation-formatters"
import type { OperationLogControllerState } from "../operation-log-controller-port"
import type { ReplayControllerState } from "./replay-controller"
import {
  mountOutputToolbar,
  type OutputToolbarMount,
} from "./output-toolbar"
import type { WorkspaceContext, WorkspacePanelMount } from "./types"

const levelLabels: Record<OperationStatus, string> = {
  observed: "记录",
  started: "开始",
  succeeded: "成功",
  failed: "失败",
}

const categoryLabels: Record<OperationCategory, string> = {
  document: "文档",
  history: "历史",
  session: "会话",
  workspace: "工作区",
  diagnostic: "诊断",
  system: "系统",
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

function emptyState(): HTMLElement {
  const empty = textElement("p", "composeui-editor__output-empty", "暂无输出。")
  empty.dataset.testid = "empty-output"
  return empty
}

function filteredEmptyState(onReset: () => void): HTMLElement {
  const empty = textElement("div", "composeui-editor__output-empty", "没有符合条件的日志")
  empty.dataset.testid = "output-empty-filtered"
  const reset = document.createElement("button")
  reset.type = "button"
  reset.dataset.testid = "output-reset-empty-filter"
  reset.textContent = "重置筛选"
  reset.addEventListener("click", onReset)
  empty.append(reset)
  return empty
}

function downloadExport(serialized: string): void {
  const blob = new Blob([serialized], { type: "application/json" })
  const anchor = document.createElement("a")
  anchor.download = "operation-log.json"
  anchor.rel = "noopener"
  const objectUrl =
    typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(blob)
      : `data:application/json;charset=utf-8,${encodeURIComponent(serialized)}`
  anchor.href = objectUrl
  anchor.click()
  if (objectUrl.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    setTimeout(() => URL.revokeObjectURL?.(objectUrl), 0)
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeText(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return `${item.toString()}n`
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[循环引用]"
        seen.add(item)
      }
      return item
    })
    return serialized ?? String(value)
  } catch {
    return "[无法显示]"
  }
}

function eventDetails(event: OperationEvent): HTMLElement {
  const details = document.createElement("aside")
  details.className = "composeui-editor__output-details"
  details.dataset.testid = "output-details"
  details.setAttribute("aria-label", "操作详情")
  details.append(textElement("h3", "composeui-editor__output-details-title", "操作详情"))

  const metadata = document.createElement("dl")
  metadata.className = "composeui-editor__output-details-meta"
  for (const [label, value] of [
    ["序号", String(event.sequence)],
    ["时间", event.timestamp],
    ["类型", event.type],
    ["状态", levelLabels[event.status]],
  ] as const) {
    const term = document.createElement("dt")
    term.textContent = label
    const description = document.createElement("dd")
    description.textContent = value
    metadata.append(term, description)
  }
  details.append(metadata)

  const summary = textElement(
    "p",
    "composeui-editor__output-details-summary",
    formatOperation(event),
  )
  details.append(summary)
  const payload = document.createElement("pre")
  payload.dataset.testid = "output-details-payload"
  payload.textContent = `payload\n${safeText(event.payload)}`
  details.append(payload)
  if (
    event.payload !== null &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload) &&
    "patch" in event.payload
  ) {
    const patch = document.createElement("pre")
    patch.dataset.testid = "output-details-patch"
    patch.textContent = `patch\n${safeText(event.payload.patch)}`
    details.append(patch)
  }
  if (event.diagnostics !== undefined && event.diagnostics.length > 0) {
    const diagnostics = document.createElement("pre")
    diagnostics.dataset.testid = "output-details-diagnostics"
    diagnostics.textContent = `diagnostics\n${safeText(event.diagnostics)}`
    details.append(diagnostics)
  }
  return details
}

export function createOutputPanelMount(): WorkspacePanelMount {
  return (root, context) => mountOutputPanel(root, context)
}

function mountOutputPanel(root: HTMLElement, context: WorkspaceContext): () => void {
  const panel = document.createElement("section")
  panel.className = "composeui-editor__output"
  panel.setAttribute("aria-label", "输出")
  const toolbar = document.createElement("div")
  toolbar.className = "composeui-editor__output-toolbar"
  toolbar.dataset.testid = "output-toolbar"
  const errorState = document.createElement("p")
  errorState.className = "composeui-editor__output-error"
  errorState.dataset.testid = "output-error"
  errorState.setAttribute("role", "status")
  errorState.hidden = true
  const body = document.createElement("div")
  body.className = "composeui-editor__output-body"
  const list = document.createElement("div")
  list.className = "composeui-editor__output-list"
  list.dataset.testid = "output-list"
  list.setAttribute("role", "log")
  list.setAttribute("aria-label", "操作日志")
  const detailsHost = document.createElement("div")
  detailsHost.className = "composeui-editor__output-details-host"
  body.append(list, detailsHost)
  const replayHost = document.createElement("div")
  replayHost.className = "composeui-editor__output-replay"
  replayHost.dataset.testid = "replay-host"
  replayHost.hidden = true
  panel.append(toolbar, errorState, replayHost, body)
  root.replaceChildren(panel)

  const controller = context.operationLog
  if (controller === undefined) {
    list.replaceChildren(emptyState())
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    }
  }

  let disposed = false
  let queryGeneration = 0
  let clearedThroughSequence = 0
  let selected: OperationEvent | undefined
  let levels: OperationStatus[] = []
  let categories: OperationCategory[] = []
  let search = ""
  let autoScroll = true
  let latestRows: readonly OperationEvent[] = []
  const replayController = controller.replayController
  let unsubscribeReplay: (() => void) | undefined

  const renderReplay = (state: ReplayControllerState): void => {
    if (replayController === undefined) return
    replayHost.hidden = !state.active
    if (!state.active) return
    replayHost.replaceChildren()
    const sequence = textElement(
      "span",
      "composeui-editor__output-replay-sequence",
      `当前序号：${state.currentSequence === undefined ? "-" : state.currentSequence}`,
    )
    sequence.dataset.testid = "replay-sequence"
    const deterministic = textElement(
      "span",
      "composeui-editor__output-replay-deterministic",
      state.deterministic ? "回放一致" : "回放存在差异",
    )
    deterministic.dataset.testid = "replay-deterministic"
    deterministic.dataset.deterministic = String(state.deterministic)
    const status = textElement("span", "composeui-editor__output-replay-status", state.status)
    status.dataset.testid = "replay-status"
    const difference = state.difference
    const replayError = state.error
    const error =
      replayError === undefined
        ? undefined
        : textElement("p", "composeui-editor__output-replay-error", replayError)
    if (error !== undefined) error.dataset.testid = "replay-error"
    if (difference !== undefined) {
      const detail = textElement("pre", "composeui-editor__output-replay-difference", "")
      detail.dataset.testid = "replay-difference"
      detail.textContent = [
        `type: ${difference.type}`,
        `sequence: ${difference.sequence}`,
        ...("path" in difference ? [`path: ${difference.path}`] : []),
        ...("expected" in difference ? [`expected: ${safeText(difference.expected)}`] : []),
        ...("actual" in difference ? [`actual: ${safeText(difference.actual)}`] : []),
      ].join("\n")
      replayHost.append(sequence, deterministic, status, detail)
    } else {
      replayHost.append(sequence, deterministic, status)
    }
    if (error !== undefined) replayHost.append(error)
    const controls = document.createElement("div")
    controls.className = "composeui-editor__output-replay-controls"
    controls.append(
      replayAction("replay-step-backward", "回放上一步", RotateCcw, () =>
        replayController.stepBackward(),
      ),
      replayAction("replay-step-forward", "回放下一步", Play, () => replayController.stepForward()),
      replayAction("replay-run-to", "回放到选中操作", Play, () => {
        if (selected === undefined) throw new Error("未选择操作")
        return replayController.runTo(selected.sequence)
      }),
      replayAction("replay-verify", "验证回放", Check, () => replayController.verify()),
      replayAction("replay-continue", "继续非确定性回放", Play, () =>
        replayController.continueBestEffort(),
      ),
      replayAction("replay-stop", "停止回放", Trash2, () => replayController.stop()),
    )
    replayHost.append(controls)
  }

  const clearError = (): void => {
    errorState.hidden = true
    errorState.textContent = ""
  }
  const showError = (action: string, error: unknown): void => {
    if (disposed) return
    errorState.hidden = false
    errorState.textContent = `${action}失败：${errorText(error)}`
  }

  const replayAction = (
    testid: string,
    label: string,
    icon: Parameters<typeof createElement>[0],
    action: () => void | Promise<unknown>,
  ): HTMLButtonElement => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "composeui-editor__output-button"
    button.dataset.testid = testid
    button.title = label
    button.setAttribute("aria-label", label)
    button.append(createElement(icon), document.createTextNode(label))
    button.addEventListener("click", () => {
      void Promise.resolve()
        .then(action)
        .catch((error) => showError(label, error))
    })
    return button
  }

  const showQueryError = (error: unknown): void => {
    if (disposed) return
    const retry = document.createElement("button")
    retry.type = "button"
    retry.dataset.testid = "output-query-retry"
    retry.textContent = "重试查询"
    retry.setAttribute("aria-label", "重试查询操作日志")
    retry.addEventListener("click", () => void refresh())
    errorState.hidden = false
    errorState.replaceChildren(
      document.createTextNode("查询操作日志失败：" + errorText(error)),
      retry,
    )
  }

  let toolbarMount: OutputToolbarMount | undefined
  const renderToolbar = (): void => {
    toolbarMount?.update({
      levels,
      categories,
      search,
      autoScroll,
      ...(selected === undefined ? {} : { selectedSequence: selected.sequence }),
      canReplaySelection: selected !== undefined,
    })
  }
  const hasActiveRestriction = (): boolean =>
    levels.length > 0 || categories.length > 0 || search.trim().length > 0

  const renderRows = (rows: readonly OperationEvent[]): void => {
    if (disposed) return
    latestRows = rows.filter((event) => event.sequence > clearedThroughSequence)
    list.replaceChildren()
    if (latestRows.length === 0) {
      list.append(hasActiveRestriction() ? filteredEmptyState(resetFilters) : emptyState())
    } else {
      for (const event of latestRows) {
        const row = document.createElement("button")
        row.type = "button"
        row.className = "composeui-editor__output-entry"
        row.dataset.testid = "output-entry"
        row.dataset.level = event.status
        row.dataset.category = event.category
        row.setAttribute("aria-selected", String(selected?.eventId === event.eventId))
        row.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation()
          selected = event
          renderRows(latestRows)
          detailsHost.replaceChildren(eventDetails(event))
          renderToolbar()
        })
        row.append(
          textElement("span", "composeui-editor__output-entry-sequence", String(event.sequence)),
          textElement("time", "composeui-editor__output-entry-time", event.timestamp),
          textElement(
            "span",
            "composeui-editor__output-entry-category",
            categoryLabels[event.category],
          ),
          textElement("span", "composeui-editor__output-entry-summary", formatOperation(event)),
        )
        list.append(row)
      }
      if (autoScroll) list.scrollTop = list.scrollHeight
    }
  }

  list.addEventListener("click", () => {
    selected = undefined
    detailsHost.replaceChildren()
    renderRows(latestRows)
    renderToolbar()
  })

  const refresh = async (): Promise<void> => {
    const generation = ++queryGeneration
    try {
      const rows = await controller.query({ levels, categories, search })
      if (disposed || generation !== queryGeneration) return
      renderRows(rows)
      clearError()
    } catch (error) {
      if (disposed || generation !== queryGeneration) return
      renderRows([])
      showQueryError(error)
    }
  }

  const resetFilters = (): void => {
    levels = []
    categories = []
    search = ""
    renderToolbar()
    void refresh()
  }

  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = ".json,application/json"
  fileInput.hidden = true
  fileInput.dataset.testid = "output-import-input"
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0]
    if (file === undefined) return
    clearError()
    void Promise.resolve()
      .then(() => file.text())
      .then((serialized) => controller.importBundle(serialized))
      .then(() => clearError())
      .catch((error) => showError("导入日志", error))
  })

  const handleImport = (): void => fileInput.click()
  const handleExport = (): void => {
    clearError()
    void Promise.resolve()
      .then(() => controller.exportSession())
      .then((serialized) => {
        downloadExport(serialized)
        clearError()
      })
      .catch((error) => showError("导出日志", error))
  }
  const clearView = (): void => {
    clearedThroughSequence = Math.max(
      clearedThroughSequence,
      ...latestRows.map((event) => event.sequence),
      0,
    )
    selected = undefined
    detailsHost.replaceChildren()
    renderRows(latestRows)
    renderToolbar()
  }
  const startSelectedReplay = (sequence: number): void => {
    clearError()
    void Promise.resolve()
      .then(() => controller.startReplay(sequence))
      .then(() => {
        if (replayController === undefined || replayController.getState().active) return undefined
        return replayController.start(sequence)
      })
      .then(() => clearError())
      .catch((error) => showError("回放操作", error))
  }
  toolbarMount = mountOutputToolbar(toolbar, {
    onSearch(nextSearch) {
      search = nextSearch
      void refresh()
    },
    onFilterChange(nextLevels, nextCategories) {
      levels = [...nextLevels]
      categories = [...nextCategories]
      void refresh()
    },
    onResetFilters: resetFilters,
    onAutoScrollChange(nextAutoScroll) {
      autoScroll = nextAutoScroll
      renderToolbar()
    },
    onImport: handleImport,
    onExport: handleExport,
    onClearView: clearView,
    onReplaySelected: startSelectedReplay,
  })
  renderToolbar()
  toolbar.append(fileInput)

  if (replayController !== undefined) {
    unsubscribeReplay = replayController.subscribe((state) => {
      if (!disposed) renderReplay(state)
    })
  }

  const unsubscribe = controller.subscribe((state: OperationLogControllerState) => {
    if (disposed) return
    queryGeneration += 1
    selected = state.detail ?? state.selection
    renderRows(
      selected !== undefined && !state.rows.some((event) => event.eventId === selected?.eventId)
        ? [...state.rows, selected]
        : state.rows,
    )
    if (selected === undefined) {
      detailsHost.replaceChildren()
    } else {
      detailsHost.replaceChildren(eventDetails(selected))
    }
    renderToolbar()
  })
  void refresh()

  return () => {
    if (disposed) return
    disposed = true
    queryGeneration += 1
    unsubscribe()
    unsubscribeReplay?.()
    toolbarMount?.dispose()
    root.replaceChildren()
  }
}
