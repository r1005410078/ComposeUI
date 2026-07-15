import type { OperationCategory, OperationEvent, OperationStatus } from "@composeui/operation-log"
import { formatOperation } from "./operation-formatters"
import type { OperationLogControllerState } from "../operation-log-controller-port"
import { mountOutputReplayBar, type OutputReplayBarMount } from "./output-replay-bar"
import { mountOutputToolbar, type OutputToolbarMount } from "./output-toolbar"
import { safeText } from "./output-value-format"
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
  body.dataset.testid = "output-body"
  const selectionAction = document.createElement("div")
  selectionAction.className = "composeui-editor__output-selection-action"
  selectionAction.dataset.testid = "output-selection-action"
  const list = document.createElement("div")
  list.className = "composeui-editor__output-list"
  list.dataset.testid = "output-list"
  list.setAttribute("role", "log")
  list.setAttribute("aria-label", "操作日志")
  const newEntries = document.createElement("button")
  newEntries.type = "button"
  newEntries.className = "composeui-editor__output-new-entries"
  newEntries.dataset.testid = "output-new-entries"
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
  let unseenCount = 0
  let lastRenderedMaximumSequence = 0
  let replayCurrentSequence: number | undefined
  let confirmClear = false
  let busyAction: "import" | "export" | "replay" | undefined
  let latestRows: readonly OperationEvent[] = []
  const replayController = controller.replayController
  let replayBar: OutputReplayBarMount | undefined

  const clearError = (): void => {
    errorState.hidden = true
    errorState.textContent = ""
  }
  const showError = (action: string, error: unknown): void => {
    if (disposed) return
    errorState.hidden = false
    errorState.textContent = `${action}失败：${errorText(error)}`
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
      confirmClear,
      ...(busyAction === undefined ? {} : { busyAction }),
    })
    renderSelectionAction()
    replayBar?.update({ busy: busyAction !== undefined })
  }
  const renderNewEntries = (): void => {
    if (unseenCount === 0) {
      newEntries.remove()
      return
    }
    newEntries.textContent = `新增 ${unseenCount} 条 · 回到底部`
    if (newEntries.parentElement === null) body.append(newEntries)
  }
  const enterHistoryReading = (): void => {
    autoScroll = false
  }
  const scrollToLatest = (): void => {
    autoScroll = true
    unseenCount = 0
    list.scrollTop = list.scrollHeight
    renderToolbar()
    renderNewEntries()
  }
  newEntries.addEventListener("click", scrollToLatest)
  const hasActiveRestriction = (): boolean =>
    levels.length > 0 || categories.length > 0 || search.trim().length > 0

  const renderRows = (rows: readonly OperationEvent[]): void => {
    if (disposed) return
    const previousScrollTop = list.scrollTop
    latestRows = rows.filter((event) => event.sequence > clearedThroughSequence)
    const nextMaximumSequence = Math.max(0, ...latestRows.map((event) => event.sequence))
    if (!autoScroll && nextMaximumSequence > lastRenderedMaximumSequence) {
      unseenCount += latestRows.filter(
        (event) =>
          event.sequence > lastRenderedMaximumSequence && event.sequence <= nextMaximumSequence,
      ).length
    }
    lastRenderedMaximumSequence = Math.max(lastRenderedMaximumSequence, nextMaximumSequence)
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
        if (event.sequence === replayCurrentSequence) row.dataset.replayCurrent = "true"
        row.setAttribute("aria-selected", String(selected?.eventId === event.eventId))
        row.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation()
          enterHistoryReading()
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
    }
    if (autoScroll) list.scrollTop = list.scrollHeight
    else list.scrollTop = previousScrollTop
    renderNewEntries()
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

  const runAsyncAction = (
    action: "import" | "export" | "replay",
    label: string,
    task: () => Promise<void>,
  ): void => {
    if (busyAction !== undefined) return
    busyAction = action
    clearError()
    void Promise.resolve()
      .then(task)
      .then(clearError)
      .catch((error) => showError(label, error))
      .finally(() => {
        if (busyAction === action) busyAction = undefined
        renderToolbar()
      })
    renderToolbar()
  }
  const handleImport = (file: File): void => {
    runAsyncAction("import", "导入日志", async () => {
      const serialized = await file.text()
      await controller.importBundle(serialized)
    })
  }
  const handleExport = (): void => {
    runAsyncAction("export", "导出日志", async () => {
      downloadExport(await controller.exportSession())
    })
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
    runAsyncAction("replay", "回放操作", async () => {
      await controller.startReplay(sequence)
      if (replayController !== undefined) {
        let state = replayController.getState()
        if (!state.active && state.error === undefined)
          state = await replayController.start(sequence)
        if (state.error !== undefined) throw new Error(state.error)
      }
    })
  }
  const renderSelectionAction = (): void => {
    selectionAction.replaceChildren()
    if (selected === undefined) {
      selectionAction.remove()
      return
    }
    const replay = document.createElement("button")
    replay.type = "button"
    replay.className = "composeui-editor__output-button"
    replay.dataset.testid = "output-selection-replay"
    replay.textContent = busyAction === "replay" ? "正在回放…" : "回放到此处"
    replay.setAttribute("aria-label", replay.textContent)
    replay.disabled = busyAction !== undefined
    replay.addEventListener("click", () => startSelectedReplay(selected!.sequence))
    selectionAction.append(replay)
    body.insertBefore(selectionAction, list)
  }
  toolbarMount = mountOutputToolbar(toolbar, {
    onSearch(nextSearch) {
      search = nextSearch
      void refresh()
    },
    onFilterChange(nextLevels, nextCategories) {
      levels = [...nextLevels]
      categories = [...nextCategories]
      renderToolbar()
      void refresh()
    },
    onResetFilters: resetFilters,
    onAutoScrollChange(nextAutoScroll) {
      if (nextAutoScroll) scrollToLatest()
      else {
        autoScroll = false
        renderToolbar()
      }
    },
    onImport: handleImport,
    onExport: handleExport,
    onRequestClear() {
      confirmClear = true
      renderToolbar()
    },
    onCancelClear() {
      confirmClear = false
      renderToolbar()
    },
    onConfirmClear() {
      confirmClear = false
      clearView()
    },
    onReplaySelected: startSelectedReplay,
  })
  renderToolbar()

  if (replayController !== undefined) {
    replayBar = mountOutputReplayBar(replayHost, {
      controller: replayController,
      getSelectedSequence: () => selected?.sequence,
      onError: showError,
      model: { busy: busyAction !== undefined },
    })
  }

  const unsubscribeReplayRows = replayController?.subscribe((state) => {
    if (disposed) return
    replayCurrentSequence = state.currentSequence
    renderRows(latestRows)
  })

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
    unsubscribeReplayRows?.()
    replayBar?.dispose()
    toolbarMount?.dispose()
    root.replaceChildren()
  }
}
