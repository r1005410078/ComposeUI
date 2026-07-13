import "dockview/dist/styles/dockview.css"
import "./theme.css"
import "./editor.css"
import "./workspace/workspace.css"

export { screenToWorld, worldToParentLocal, worldToScreen, zoomAt } from "./coordinates"
export type { Point } from "./coordinates"
export { mountEditor } from "./editor-view"
export type { MountedEditor, MountEditorOptions } from "./editor-view"
export { mountComponentTree } from "./component-tree"
export type { MountComponentTreeOptions, MountedComponentTree } from "./component-tree"
export { EditorSession } from "./session"
export type {
  EditorSessionOperationObserver,
  EditorSessionOptions,
  EditorSessionState,
  InteractionMode,
  SessionOperation,
  Viewport,
} from "./session"
export { createSessionOperationObserver } from "./operation-log-adapter"
export { OperationLogController } from "./operation-log-controller"
export type {
  OperationLogControllerListener,
  OperationLogControllerOptions,
  OperationLogControllerState,
  OperationLogFilter,
  OperationLogFilterValue,
} from "./operation-log-controller"

export {
  PanelRegistry,
  WorkspacePanelRegistry,
  WorkspaceRegistryError,
  createPanelRegistry,
} from "./workspace/panel-registry"
export {
  ModeRegistry,
  WorkspaceModeRegistry,
  ModeRegistryError,
  createModeRegistry,
} from "./workspace/mode-registry"
export { createLocalStorageLayoutStore } from "./workspace/layout-store"
export type { StorageLike } from "./workspace/layout-store"
export {
  mountEditorWorkspace,
  type DockviewFactory,
  type EditorWorkspaceApi,
  type EditorWorkspaceDockview,
  type MountEditorWorkspaceOptions,
  type MountedEditorWorkspace,
} from "./workspace/editor-workspace"
export { mountWorkspaceToolbar } from "./workspace/toolbar"
export type { WorkspaceToolbarOptions } from "./workspace/toolbar"
export type {
  MountedWorkspace,
  StoredWorkspaceLayout,
  WorkspaceCommand,
  WorkspaceCommandApi,
  WorkspaceContext,
  WorkspaceEvent,
  WorkspaceLayoutFailureEvent,
  WorkspaceLayoutStore,
  WorkspaceModeDescriptor,
  WorkspacePanelDescriptor,
  WorkspacePanelFailureEvent,
  WorkspacePanelMount,
  WorkspacePanelPosition,
  WorkspaceResourceService,
  WorkspaceToolbar,
  WorkspaceToolbarItem,
} from "./workspace/types"
