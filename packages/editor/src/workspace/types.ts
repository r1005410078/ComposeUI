/**
 * @module workspace/types
 *
 * Dockview 工作区的共享类型：上下文、命令、面板描述符、布局持久化、事件。
 *
 * 布局（panel 分栏）属 workspace 会话/本地存储，不等于 PageDocument。
 * 面板 mount 函数可返回 destroy，由 workspace 在卸下面板时调用。
 */

import type { Editor } from "@composeui/core"
import type { EditorPreviewSource } from "../editor-view"
import type { EditorSession } from "../session"
import type { OperationLogControllerPort } from "../operation-log-controller-port"

/** 注入每个面板 mount 的运行时上下文。 */
export interface WorkspaceContext {
  editor: Editor
  session: EditorSession
  pageId: string
  api: WorkspaceCommandApi
  resources?: WorkspaceResourceService
  operationLog?: OperationLogControllerPort
  preview?: EditorPreviewSource
  emit: (event: WorkspaceEvent) => void
}

/** 工具栏与 API 共用的工作区命令（非文档 EditorCommand）。 */
export type WorkspaceCommand =
  | { type: "open-panel"; panelId: string }
  | { type: "close-panel"; panelId: string }
  | { type: "reset-layout" }
  | { type: "undo" }
  | { type: "redo" }

export interface WorkspaceCommandApi {
  execute(command: WorkspaceCommand): void | Promise<void>
  undo(): void | Promise<void>
  redo(): void | Promise<void>
  openPanel(panelId: string): void | Promise<void>
  closePanel(panelId: string): void | Promise<void>
  resetLayout(): void | Promise<void>
}

export type WorkspacePanelMount = (
  root: HTMLElement,
  context: WorkspaceContext,
) => void | (() => void) | { destroy(): void }

export interface WorkspacePanelDescriptor {
  id: string
  title: string
  mount: WorkspacePanelMount
  closable: boolean
  defaultPosition: WorkspacePanelPosition
  icon?: string
  defaultSize?: number
  minimumSize?: number
}

export type WorkspacePanelPosition = "left" | "right" | "top" | "bottom" | "center"

export interface WorkspaceToolbarItem {
  id: string
  label: string
  icon?: string
  tooltip?: string
  command?: WorkspaceCommand
}

export interface WorkspaceToolbar {
  items: readonly WorkspaceToolbarItem[]
}

export interface WorkspaceModeDescriptor {
  id: string
  title: string
  createLayout(): unknown
  toolbar: WorkspaceToolbar
  icon?: string
}

export interface WorkspaceLayoutStore {
  load(): Promise<StoredWorkspaceLayout | undefined>
  save(layout: StoredWorkspaceLayout): Promise<void>
  remove(): Promise<void>
}

export interface WorkspaceResourceService {
  list(): readonly unknown[] | Promise<readonly unknown[]>
}

/** 本地持久化的 Dockview 布局；version/modeId 用于拒绝不兼容快照。 */
export interface StoredWorkspaceLayout {
  version: 1
  modeId: "2d"
  /** dockview toJSON 产物，结构对 editor 不透明。 */
  layout: unknown
}

export interface WorkspaceError {
  name: string
  message: string
  code?: string
}

/** 将未知 throw 值规范为可序列化 WorkspaceError（供事件总线/日志）。 */
export function serializeWorkspaceError(error: unknown): WorkspaceError {
  if (error !== null && typeof error === "object") {
    const name = readStringProperty(error, "name")
    const message = readStringProperty(error, "message")
    const code = readStringProperty(error, "code")
    return {
      name: name ?? "Error",
      message: message ?? toErrorMessage(error),
      ...(code === undefined ? {} : { code }),
    }
  }
  return { name: "Error", message: toErrorMessage(error) }
}

function readStringProperty(error: object, key: "name" | "message" | "code"): string | undefined {
  try {
    const value = (error as Record<string, unknown>)[key]
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}

function toErrorMessage(error: unknown): string {
  try {
    return String(error)
  } catch {
    return "Unknown error"
  }
}

export interface WorkspaceLayoutFailureEvent {
  type: "layout-failure"
  operation: "load" | "save" | "remove"
  error: unknown
}

export interface WorkspacePanelFailureEvent {
  type: "panel-failure"
  panelId: string
  error: unknown
}

/** 工作区运行时事件；failure 类的 error 可能是原始 throw 值。 */
export type WorkspaceEvent =
  | { type: "panel-opened"; panelId: string }
  | { type: "panel-closed"; panelId: string }
  | { type: "panel-activated"; panelId: string }
  | { type: "layout-changed"; layout: StoredWorkspaceLayout }
  | { type: "layout-loaded"; layout: StoredWorkspaceLayout }
  | { type: "layout-reset"; layout: StoredWorkspaceLayout }
  | WorkspaceLayoutFailureEvent
  | WorkspacePanelFailureEvent

/** 跨边界传递用：failure.error 已序列化为 WorkspaceError。 */
export type SerializedWorkspaceEvent =
  | Exclude<WorkspaceEvent, WorkspaceLayoutFailureEvent | WorkspacePanelFailureEvent>
  | { type: "layout-failure"; operation: "load" | "save" | "remove"; error: WorkspaceError }
  | { type: "panel-failure"; panelId: string; error: WorkspaceError }

export interface MountedWorkspace {
  readonly session: EditorSession
  readonly api: WorkspaceCommandApi
  dispose(): void
  destroy(): void
  resetLayout(): Promise<void>
}
