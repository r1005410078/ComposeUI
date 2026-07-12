import type { Editor } from "@composeui/core"
import type { EditorSession } from "../session"

export interface WorkspaceContext {
  editor: Editor
  session: EditorSession
  pageId: string
  resources?: WorkspaceResourceService
}

export type WorkspacePanelMount = (
  root: HTMLElement,
  context: WorkspaceContext,
) => void | (() => void) | { destroy(): void }

export interface WorkspacePanelDescriptor {
  id: string
  title: string
  mount: WorkspacePanelMount
  icon?: string
  defaultSize?: number
  minimumSize?: number
}

export interface WorkspaceModeDescriptor {
  id: string
  title: string
  createLayout(): unknown
  icon?: string
}

export interface WorkspaceLayoutStore {
  load(): Promise<StoredWorkspaceLayout | undefined>
  save(layout: StoredWorkspaceLayout): Promise<void>
  remove(): Promise<void>
  reset(): Promise<void>
}

export interface WorkspaceResourceService {
  list(): readonly unknown[] | Promise<readonly unknown[]>
}

export interface StoredWorkspaceLayout {
  version: 1
  modeId: "2d"
  layout: unknown
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

export type WorkspaceEvent = WorkspaceLayoutFailureEvent | WorkspacePanelFailureEvent

export interface MountedWorkspace {
  destroy(): void
  resetLayout(): Promise<void>
}
