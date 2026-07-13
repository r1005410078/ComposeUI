import type { OperationCategory, OperationEvent, OperationStatus } from "@composeui/operation-log"
import {
  Check,
  CircleAlert,
  Download,
  FileInput,
  Filter,
  Play,
  RotateCcw,
  Search,
  Trash2,
  createElement,
} from "lucide"
import { formatOperation } from "./operation-formatters"
import type { OperationLogControllerState } from "../operation-log-controller-port"
import type { WorkspaceContext, WorkspacePanelMount } from "./types"

const LEVELS: readonly OperationStatus[] = ["observed", "started", "succeeded", "failed"]
const CATEGORIES: readonly OperationCategory[] = [
  "document",
  "history",
  "session",
  "workspace",
  "diagnostic",
  "system",
]

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

function icon(node: Parameters<typeof createElement>[0]): SVGElement {
  return createElement(node)
}

function button(
  testid: string,
  label: string,
  iconNode: Parameters<typeof import("lucide").createElement>[0],
  onClick: () => void,
): HTMLButtonElement {
  const element = document.createElement("button")
  element.type = "button"
  element.dataset.testid = testid
  element.className = "composeui-editor__output-button"
  element.setAttribute("aria-label", label)
  element.title = label
  element.append(icon(iconNode))
  element.addEventListener("click", onClick)
  return element
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
  panel.append(toolbar, body)
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

  const renderRows = (rows: readonly OperationEvent[]): void => {
    if (disposed) return
    latestRows = rows.filter((event) => event.sequence > clearedThroughSequence)
    list.replaceChildren()
    if (latestRows.length === 0) {
      list.append(emptyState())
    } else {
      for (const event of latestRows) {
        const row = document.createElement("button")
        row.type = "button"
        row.className = "composeui-editor__output-entry"
        row.dataset.testid = "output-entry"
        row.dataset.level = event.status
        row.dataset.category = event.category
        row.setAttribute("aria-selected", String(selected?.eventId === event.eventId))
        row.addEventListener("click", () => {
          selected = event
          renderRows(latestRows)
          detailsHost.replaceChildren(eventDetails(event))
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
    if (
      selected !== undefined &&
      !latestRows.some((event) => event.eventId === selected?.eventId)
    ) {
      selected = undefined
      detailsHost.replaceChildren()
    }
  }

  const refresh = async (): Promise<void> => {
    const generation = ++queryGeneration
    try {
      const rows = await controller.query({ levels, categories, search })
      if (disposed || generation !== queryGeneration) return
      renderRows(rows)
    } catch {
      if (disposed || generation !== queryGeneration) return
      renderRows([])
    }
  }

  const toggleLevel = (level: OperationStatus): void => {
    levels = levels.includes(level) ? levels.filter((item) => item !== level) : [level]
    void refresh()
  }
  const toggleCategory = (category: OperationCategory): void => {
    categories = categories.includes(category)
      ? categories.filter((item) => item !== category)
      : [category]
    void refresh()
  }

  toolbar.append(
    button("output-clear", "清空当前视图", Trash2, () => {
      clearedThroughSequence = Math.max(
        clearedThroughSequence,
        ...latestRows.map((event) => event.sequence),
        0,
      )
      selected = undefined
      detailsHost.replaceChildren()
      renderRows(latestRows)
    }),
  )
  const levelGroup = document.createElement("div")
  levelGroup.className = "composeui-editor__output-filter-group"
  levelGroup.append(textElement("span", "composeui-editor__output-filter-label", "级别"))
  for (const level of LEVELS) {
    const filterButton = button(
      `output-level-${level === "failed" ? "error" : level}`,
      levelLabels[level],
      level === "failed" ? CircleAlert : Check,
      () => toggleLevel(level),
    )
    filterButton.dataset.level = level
    levelGroup.append(filterButton)
  }
  toolbar.append(levelGroup)

  const categoryGroup = document.createElement("div")
  categoryGroup.className = "composeui-editor__output-filter-group"
  categoryGroup.append(textElement("span", "composeui-editor__output-filter-label", "分类"))
  for (const category of CATEGORIES) {
    const filterButton = button(
      `output-category-${category}`,
      categoryLabels[category],
      Filter,
      () => toggleCategory(category),
    )
    filterButton.dataset.category = category
    categoryGroup.append(filterButton)
  }
  toolbar.append(categoryGroup)

  const searchLabel = document.createElement("label")
  searchLabel.className = "composeui-editor__output-search"
  searchLabel.append(icon(Search))
  const searchInput = document.createElement("input")
  searchInput.type = "search"
  searchInput.placeholder = "搜索操作日志"
  searchInput.setAttribute("aria-label", "搜索操作日志")
  searchInput.addEventListener("input", () => {
    search = searchInput.value
    void refresh()
  })
  searchLabel.append(searchInput)
  toolbar.append(searchLabel)

  toolbar.append(
    button("output-auto-scroll", "自动滚动", RotateCcw, () => {
      autoScroll = !autoScroll
      toolbar
        .querySelector<HTMLButtonElement>("[data-testid='output-auto-scroll']")
        ?.toggleAttribute("aria-pressed", autoScroll)
    }),
    button("output-import", "导入日志", FileInput, () => fileInput.click()),
    button("output-export", "导出日志", Download, () => {
      void controller.exportSession()
    }),
    button("output-replay", "回放选中操作", Play, () => {
      if (selected !== undefined) void controller.startReplay(selected.sequence)
    }),
  )

  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = ".json,application/json"
  fileInput.hidden = true
  fileInput.dataset.testid = "output-import-input"
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0]
    if (file === undefined) return
    void file.text().then((serialized) => controller.importBundle(serialized))
  })
  toolbar.append(fileInput)

  const unsubscribe = controller.subscribe((state: OperationLogControllerState) => {
    if (disposed) return
    selected = state.detail
    void refresh()
  })
  void refresh()

  return () => {
    if (disposed) return
    disposed = true
    queryGeneration += 1
    unsubscribe()
    root.replaceChildren()
  }
}
