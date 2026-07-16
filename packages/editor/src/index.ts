/**
 * @module @composeui/editor
 *
 * 可嵌入的编辑器 UI 层：Session、画布、组件树、Dockview workspace、操作日志与回放壳。
 *
 * 依赖 `@composeui/core` 做文档权威写入；本包负责会话态与 DOM。
 * 引入本入口会加载 editor/theme/workspace 样式与 dockview CSS。
 *
 * 典型组合：createEditor → EditorSession → mountEditorWorkspace / mountEditor。
 */

import "dockview/dist/styles/dockview.css"
import "./styles/theme.css"
import "./styles/editor.css"
import "./styles/workspace.css"

export { screenToWorld, worldToParentLocal, worldToScreen, zoomAt } from "./session/coordinates"
export type { Point } from "./session/coordinates"
export { mountEditor } from "./canvas/mount"
export type {
  EditorPreviewFrame,
  EditorPreviewSource,
  MountedEditor,
  MountEditorOptions,
} from "./canvas/mount"
export { mountComponentTree } from "./tree/component-tree"
export type { MountComponentTreeOptions, MountedComponentTree } from "./tree/component-tree"
export { EditorSession } from "./session/session"
export type {
  EditorSessionOperationObserver,
  EditorSessionOptions,
  EditorSessionState,
  InteractionMode,
  SessionOperation,
  Viewport,
} from "./session/session"
export { createSessionOperationObserver } from "./operation-log/adapter"
export {
  ReplayController,
  EditorSessionReplayAdapter,
  type ReplayControllerListener,
  type ReplayControllerPort,
  type ReplayControllerState,
  type ReplayControllerOptions,
  type ReplayEngineFactory,
  type ReplayEngineLike,
} from "./workspace/replay-controller"
export { formatOperation, registerOperationFormatter } from "./workspace/operation-formatters"
export type { OperationFormatter } from "./workspace/operation-formatters"
export { OperationLogController } from "./operation-log/controller"
export type {
  OperationLogControllerListener,
  OperationLogControllerPort,
  OperationLogControllerOptions,
  OperationLogControllerState,
  OperationLogFilter,
  OperationLogFilterValue,
  OperationLogLevel,
  OperationLogViewQuery,
} from "./operation-log/controller"

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
  WorkspaceError,
  SerializedWorkspaceEvent,
  WorkspaceToolbar,
  WorkspaceToolbarItem,
} from "./workspace/types"
