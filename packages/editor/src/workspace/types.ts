import type { Editor } from "@composeui/core"
import type { EditorSession } from "../session"
import type { OperationLogControllerPort } from "../operation-log-controller-port"

export interface WorkspaceContext {
  editor: Editor
  session: EditorSession
  pageId: string
  api: WorkspaceCommandApi
  resources?: WorkspaceResourceService
  operationLog?: OperationLogControllerPort
  emit: (event: WorkspaceContextEvent) => void
}

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

export interface StoredWorkspaceLayout {
  version: 1
  modeId: "2d"
  layout: unknown
}

export interface WorkspaceError {
  name: string
  message: string
  code?: string
}

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
  error: WorkspaceError
}

export interface WorkspacePanelFailureEvent {
  type: "panel-failure"
  panelId: string
  error: WorkspaceError
}

export type WorkspaceEvent =
  | { type: "panel-opened"; panelId: string }
  | { type: "panel-closed"; panelId: string }
  | { type: "panel-activated"; panelId: string }
  | { type: "layout-changed"; layout: StoredWorkspaceLayout }
  | { type: "layout-loaded"; layout: StoredWorkspaceLayout }
  | { type: "layout-reset"; layout: StoredWorkspaceLayout }
  | WorkspaceLayoutFailureEvent
  | WorkspacePanelFailureEvent

export type WorkspaceContextEvent =
  | WorkspaceEvent
  | { type: "layout-failure"; operation: "load" | "save" | "remove"; error: unknown }
  | { type: "panel-failure"; panelId: string; error: unknown }

export interface MountedWorkspace {
  readonly session: EditorSession
  readonly api: WorkspaceCommandApi
  dispose(): void
  destroy(): void
  resetLayout(): Promise<void>
}
