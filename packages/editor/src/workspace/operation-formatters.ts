import type { OperationEvent } from "@composeui/operation-log"

export type OperationFormatter = (event: OperationEvent) => string

const formatters = new Map<string, OperationFormatter>()

export function registerOperationFormatter(
  type: string,
  formatter: OperationFormatter,
): () => void {
  if (type.trim().length === 0) throw new Error("OPERATION_FORMATTER_TYPE_REQUIRED")
  formatters.set(type, formatter)
  return () => {
    if (formatters.get(type) === formatter) formatters.delete(type)
  }
}

export function formatOperation(event: OperationEvent): string {
  const formatter = formatters.get(event.type)
  try {
    return formatter?.(event) ?? formatFallback(event)
  } catch {
    return formatFallback(event)
  }
}

function formatFallback(event: OperationEvent): string {
  const detail = safeText(event.payload)
  const suffix = formatStatus(event.status)
  return detail === "{}" ? `${event.type} · ${suffix}` : `${event.type} · ${suffix} · ${detail}`
}

function formatDocument(event: OperationEvent): string {
  const payload = asRecord(event.payload)
  const command = asRecord(payload?.command)
  const commandId = stringValue(command?.id) ?? event.type
  const commandPayload = asRecord(command?.payload)
  const id = stringValue(commandPayload?.id) ?? firstId(commandPayload?.ids) ?? "节点"
  let summary: string

  switch (commandId) {
    case "node.create":
      summary = `创建“${stringValue(commandPayload?.name) ?? id}”`
      break
    case "node.move":
      summary = formatMove(id, commandPayload, asRecord(payload?.patch))
      break
    case "node.resize":
    case "node.resizeMany":
      summary = formatResize(id, commandPayload)
      break
    case "node.rename":
      summary = `重命名“${id}”为“${stringValue(commandPayload?.name) ?? "未命名"}”`
      break
    case "node.delete":
      summary = `删除${formatIds(commandPayload?.ids)}`
      break
    case "node.reorder":
      summary = `调整“${id}”层级顺序`
      break
    case "node.setVisible":
      summary = `${booleanValue(commandPayload?.visible) ? "显示" : "隐藏"}“${id}”`
      break
    case "node.setLocked":
      summary = `${booleanValue(commandPayload?.locked) ? "锁定" : "解锁"}“${id}”`
      break
    case "page.setOverflow":
      summary = `设置页面溢出显示`
      break
    default:
      summary = `${commandId}`
  }

  const patchSummary = formatPatchSummary(payload?.patch)
  return `${summary} · ${formatStatus(event.status)}${patchSummary}${formatDiagnostics(event)}`
}

function formatMove(
  id: string,
  payload: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): string {
  const updated = Array.isArray(patch?.updated) ? patch.updated : []
  const update = updated
    .map((item) => asRecord(item))
    .find((item) => item !== undefined && item.id === id)
  const before = point(update?.before) ?? point(payload?.before)
  const after = point(update?.after) ?? point(payload?.after)
  if (before !== undefined && after !== undefined) {
    return `移动“${id}”：${formatPoint(before)} -> ${formatPoint(after)}`
  }
  const delta = point(payload?.delta)
  return delta === undefined ? `移动“${id}”` : `移动“${id}”：偏移 ${formatPoint(delta)}`
}

function formatPatchSummary(value: unknown): string {
  if (Array.isArray(value)) return ` · 补丁 ${value.length} 项`
  const patch = asRecord(value)
  if (patch === undefined) return ""
  const count = ["created", "updated", "removed"].reduce(
    (total, key) => total + (Array.isArray(patch[key]) ? patch[key].length : 0),
    0,
  )
  return count === 0 ? "" : ` · 补丁 ${count} 项`
}

function formatResize(id: string, payload: Record<string, unknown> | undefined): string {
  const items = Array.isArray(payload?.items) ? payload.items : [payload]
  const first = asRecord(items[0])
  const size =
    first === undefined
      ? undefined
      : { width: numberValue(first.width), height: numberValue(first.height) }
  if (size?.width !== undefined && size.height !== undefined) {
    return `调整“${stringValue(first?.id) ?? id}”大小：${size.width} × ${size.height}`
  }
  return `调整“${id}”大小`
}

function formatHistory(event: OperationEvent): string {
  const name =
    event.type === "history.undo" ? "撤销" : event.type === "history.redo" ? "重做" : "跳转历史"
  const index = numberValue(asRecord(event.payload)?.currentIndex)
  return `${name}${index === undefined ? "" : ` · 第 ${index} 项`} · ${formatStatus(event.status)}${formatDiagnostics(event)}`
}

function formatSession(event: OperationEvent): string {
  const payload = asRecord(event.payload)
  switch (event.type) {
    case "session.viewport": {
      const viewport = asRecord(payload?.viewport)
      return `视口：${formatPoint(viewport)} · 缩放 ${numberValue(viewport?.zoom) ?? "?"}`
    }
    case "session.selection":
      return `选择 ${Array.isArray(payload?.selection) ? payload.selection.length : 0} 个对象`
    case "session.expandedTree":
      return `场景树展开 ${Array.isArray(payload?.expanded) ? payload.expanded.length : 0} 项`
    case "session.gridVisibility":
      return `${booleanValue(payload?.gridVisible) ? "显示" : "隐藏"}网格`
    case "session.interactionMode":
      return `切换交互模式：${stringValue(payload?.interactionMode) ?? "未知"}`
    case "session.hoveredId":
      return `悬停对象：${stringValue(payload?.hoveredId) ?? "无"}`
    default:
      return `${event.type} · ${formatStatus(event.status)}`
  }
}

function formatDiagnostic(event: OperationEvent): string {
  return `诊断：${formatDiagnostics(event).replace(/^ · /, "") || "无"} · ${formatStatus(event.status)}`
}

function formatWorkspace(event: OperationEvent): string {
  const panelId = stringValue(asRecord(event.payload)?.panelId) ?? "未知"
  switch (event.type) {
    case "workspace.panel.opened":
      return `打开面板：${panelId}`
    case "workspace.panel.closed":
      return `关闭面板：${panelId}`
    case "workspace.panel.activated":
      return `激活面板：${panelId}`
    case "workspace.layout.changed":
      return "更新工作区布局"
    case "workspace.layout.loaded":
      return "加载工作区布局"
    case "workspace.layout.reset":
      return "重置工作区布局"
    default:
      return `${event.type} · ${formatStatus(event.status)}`
  }
}

function formatDiagnostics(event: OperationEvent): string {
  if (!event.diagnostics || event.diagnostics.length === 0) return ""
  return ` · ${event.diagnostics.map((item) => `${item.code}：${item.message}`).join("；")}`
}

function formatStatus(status: OperationEvent["status"]): string {
  return { observed: "已记录", started: "开始", succeeded: "成功", failed: "失败" }[status]
}

function formatPoint(value: unknown): string {
  const coordinate = pointValue(value)
  return coordinate === undefined ? "(?, ?)" : `(${coordinate.x}, ${coordinate.y})`
}

function point(value: unknown): { x: number; y: number } | undefined {
  const record = asRecord(value)
  const x = numberValue(record?.x)
  const y = numberValue(record?.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function pointValue(value: unknown): { x: number; y: number } | undefined {
  return point(value)
}

function formatIds(value: unknown): string {
  if (!Array.isArray(value)) return "节点"
  return value.length === 1 ? `“${String(value[0])}”` : `${value.length} 个节点`
}

function firstId(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function safeText(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === "bigint") return `${item.toString()}n`
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[循环引用]"
          seen.add(item)
        }
        return item
      }) ?? String(value)
    )
  } catch {
    return "[无法显示 payload]"
  }
}

registerOperationFormatter("document.command", formatDocument)
registerOperationFormatter("history.undo", formatHistory)
registerOperationFormatter("history.redo", formatHistory)
registerOperationFormatter("history.jump", formatHistory)
registerOperationFormatter("session.selection", formatSession)
registerOperationFormatter("session.viewport", formatSession)
registerOperationFormatter("session.expandedTree", formatSession)
registerOperationFormatter("session.gridVisibility", formatSession)
registerOperationFormatter("session.interactionMode", formatSession)
registerOperationFormatter("session.hoveredId", formatSession)
registerOperationFormatter("diagnostic", formatDiagnostic)
registerOperationFormatter("diagnostic.reported", formatDiagnostic)
registerOperationFormatter("workspace.panel.opened", formatWorkspace)
registerOperationFormatter("workspace.panel.closed", formatWorkspace)
registerOperationFormatter("workspace.panel.activated", formatWorkspace)
registerOperationFormatter("workspace.layout.changed", formatWorkspace)
registerOperationFormatter("workspace.layout.loaded", formatWorkspace)
registerOperationFormatter("workspace.layout.reset", formatWorkspace)
registerOperationFormatter(
  "system",
  (event) => `系统操作 · ${formatStatus(event.status)}${formatDiagnostics(event)}`,
)
registerOperationFormatter(
  "system.sessionStarted",
  (event) => `会话开始 · ${formatStatus(event.status)}`,
)
registerOperationFormatter(
  "system.checkpoint",
  (event) => `创建检查点 · ${formatStatus(event.status)}`,
)
registerOperationFormatter(
  "system.sessionEnded",
  (event) => `会话结束 · ${formatStatus(event.status)}`,
)
registerOperationFormatter(
  "workspace.panel",
  (event) => `工作区面板操作 · ${formatStatus(event.status)}${formatDiagnostics(event)}`,
)
registerOperationFormatter(
  "workspace.layout",
  (event) => `工作区布局操作 · ${formatStatus(event.status)}${formatDiagnostics(event)}`,
)
registerOperationFormatter(
  "workspace",
  (event) => `工作区操作 · ${formatStatus(event.status)}${formatDiagnostics(event)}`,
)
