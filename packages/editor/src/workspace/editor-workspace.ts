import {
  createDockview,
  type AddPanelOptions,
  type IContentRenderer,
  type ITabRenderer,
} from "dockview"
import { Play, Save, createElement as createIconElement } from "lucide"
import type { Editor } from "@composeui/core"
import type { OperationLogController } from "../operation-log-controller"
import { EditorSession } from "../session"
import { createModeRegistry, type ModeRegistry } from "./mode-registry"
import type { PanelRegistry } from "./panel-registry"
import { createWorkspacePanels } from "./panels"
import { mountWorkspaceToolbar } from "./toolbar"
import type {
  WorkspaceCommand,
  WorkspaceCommandApi,
  WorkspaceContext,
  WorkspaceEvent,
  WorkspaceLayoutStore,
  WorkspacePanelDescriptor,
  WorkspacePanelMount,
  WorkspaceResourceService,
} from "./types"

export interface WorkspacePanelRegistry {
  all(): WorkspacePanelDescriptor[]
}

export interface EditorWorkspaceDockview {
  readonly onDidLayoutChange?:
    | ((listener: () => void) => { dispose(): void })
    | { subscribe(listener: () => void): { dispose(): void } }
  addPanel(options: AddPanelOptions): { id: string; focus?(): void }
  getPanel(id: string): { id: string; focus?(): void } | undefined
  removePanel(panel: { id: string }): void
  toJSON(): unknown
  fromJSON(layout: unknown): void
  clear?(): void
  dispose(): void
}

export type DockviewFactory = (
  root: HTMLElement,
  options: {
    createComponent(options: { id: string; name: string }): IContentRenderer
    createTabComponent?(options: { id: string; name: string }): ITabRenderer | undefined
  },
) => EditorWorkspaceDockview

export interface MountEditorWorkspaceOptions {
  pageId: string
  projectTitle?: string
  mountToolbarExtras?: (root: HTMLElement) => void | (() => void) | { destroy(): void }
  mountSceneExtras?: (root: HTMLElement) => void | (() => void) | { destroy(): void }
  layoutStore?: WorkspaceLayoutStore
  resources?: WorkspaceResourceService
  operationLog?: OperationLogController
  panelRegistry?: PanelRegistry | WorkspacePanelRegistry
  modeRegistry?: ModeRegistry
  createDockview?: DockviewFactory
  onRun?: () => void
  onSave?: () => void
  onEvent?: (event: WorkspaceEvent) => void
}

export interface MountedEditorWorkspace {
  readonly session: EditorSession
  readonly api: EditorWorkspaceApi
  dispose(): void
}

export interface EditorWorkspaceApi {
  execute(command: WorkspaceCommand): void | Promise<void>
  undo(): void
  redo(): void
  openPanel(panelId: string): boolean
  closePanel(panelId: string): boolean
  focusPanel(panelId: string): void
  resetLayout(): Promise<void>
}

const CANVAS = "canvas"
const CANVAS_ERROR = "画布不可用。"
const NON_CLOSABLE_TAB = "workspace-non-closable-tab"

function isCanvas(id: string): boolean {
  return id === CANVAS || id.startsWith(`${CANVAS}:`)
}

function canvasId(pageId: string): string {
  return `${CANVAS}:${pageId}`
}

function panelId(id: string, pageId: string): string {
  return isCanvas(id) ? canvasId(pageId) : id
}

function replaceCanvasIds(value: unknown, pageId: string): unknown {
  if (typeof value === "string") return isCanvas(value) ? canvasId(pageId) : value
  if (Array.isArray(value)) return value.map((item) => replaceCanvasIds(item, pageId))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceCanvasIds(item, pageId)]),
    )
  }
  return value
}

function containsPanel(value: unknown, id: string): boolean {
  if (typeof value === "string") return value === id
  if (Array.isArray(value)) return value.some((item) => containsPanel(item, id))
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => containsPanel(item, id))
  }
  return false
}

function toDisposer(mount: ReturnType<WorkspacePanelMount>): (() => void) | undefined {
  if (typeof mount === "function") return mount
  if (mount !== undefined) return () => mount.destroy()
  return undefined
}

function toToolbarExtrasDisposer(
  mount: ReturnType<
    NonNullable<
      | MountEditorWorkspaceOptions["mountToolbarExtras"]
      | MountEditorWorkspaceOptions["mountSceneExtras"]
    >
  >,
): (() => void) | undefined {
  if (typeof mount === "function") return mount
  if (mount !== undefined) return () => mount.destroy()
  return undefined
}

function errorPanel(root: HTMLElement, title: string, message: string): void {
  const panel = document.createElement("section")
  panel.setAttribute("role", "alert")
  panel.dataset.testid = "workspace-panel-error"
  const heading = document.createElement("h2")
  heading.textContent = title
  const text = document.createElement("p")
  text.textContent = message
  panel.append(heading, text)
  root.replaceChildren(panel)
}

function preventNonClosableTabDelete(event: KeyboardEvent): void {
  if (event.key !== "Delete" && event.key !== "Backspace") return
  event.preventDefault()
  event.stopPropagation()
}

function appBarButton(
  id: string,
  label: string,
  icon: Parameters<typeof createIconElement>[0],
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "composeui-editor__app-action"
  button.dataset.testid = `workspace-${id}`
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createIconElement(icon))
  return button
}

function createNonClosableTab(): ITabRenderer {
  const element = document.createElement("div")
  element.className = "composeui-editor__non-closable-tab"
  let disposeClick: (() => void) | undefined
  let disposeKeydown: (() => void) | undefined
  return {
    element,
    init(params) {
      element.textContent = params.title
      const activate = (): void => params.api.setActive()
      element.addEventListener("click", activate)
      element.addEventListener("keydown", preventNonClosableTabDelete)
      disposeClick = () => element.removeEventListener("click", activate)
      disposeKeydown = () => element.removeEventListener("keydown", preventNonClosableTabDelete)
    },
    dispose() {
      disposeClick?.()
      disposeClick = undefined
      disposeKeydown?.()
      disposeKeydown = undefined
    },
  }
}

export function mountEditorWorkspace(
  root: HTMLElement,
  editor: Editor,
  options: MountEditorWorkspaceOptions,
): MountedEditorWorkspace {
  const session = new EditorSession()
  const events = options.onEvent ?? (() => undefined)
  const pageId = options.pageId
  const registry = new Map<string, WorkspacePanelDescriptor>()
  for (const panel of createWorkspacePanels()) registry.set(panel.id, panel)
  for (const panel of options.panelRegistry?.all() ?? []) registry.set(panel.id, panel)
  const modeRegistry = createModeRegistry()
  for (const mode of options.modeRegistry?.all() ?? []) modeRegistry.register(mode)
  if (!modeRegistry.has("2d")) {
    modeRegistry.register({
      id: "2d",
      title: "2D",
      createLayout: () => undefined,
      toolbar: { items: [] },
    })
  }

  const disposers = new Map<string, () => void>()
  let disposed = false
  let applyingLayout = false
  let layoutDirty = false

  root.classList.add("composeui-editor__workspace-host")
  root.style.setProperty("--composeui-workspace-min-height", "320px")
  const shell = document.createElement("div")
  shell.className = "composeui-editor__workspace-shell"
  const header = document.createElement("header")
  header.className = "composeui-editor__workspace-header composeui-editor__app-bar"
  const title = document.createElement("div")
  title.className = "composeui-editor__project-title"
  title.dataset.testid = "workspace-project-title"
  title.textContent = options.projectTitle ?? "未命名项目"
  const modeSlot = document.createElement("div")
  modeSlot.className = "composeui-editor__mode-slot"
  const actions = document.createElement("div")
  actions.className = "composeui-editor__app-actions"
  const run = appBarButton("run", "运行项目", Play)
  run.addEventListener("click", () => options.onRun?.())
  const save = appBarButton("save", "保存项目", Save)
  save.addEventListener("click", () => options.onSave?.())
  actions.append(run, save)
  const dockviewHost = document.createElement("div")
  dockviewHost.className = "composeui-editor__dockview-host"
  header.append(title, modeSlot, actions)
  shell.append(header, dockviewHost)
  root.replaceChildren(shell)

  if (modeRegistry.shouldRenderModeBar()) {
    const modeBar = document.createElement("nav")
    modeBar.className = "composeui-editor__mode-bar"
    modeBar.dataset.testid = "workspace-mode-bar"
    modeBar.setAttribute("aria-label", "编辑器模式")
    for (const mode of modeRegistry.all()) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = mode.title
      button.dataset.modeId = mode.id
      button.disabled = true
      if (mode.id === "2d") button.setAttribute("aria-current", "page")
      modeBar.append(button)
    }
    modeSlot.append(modeBar)
  }

  const dockview = (options.createDockview ?? (createDockview as unknown as DockviewFactory))(
    dockviewHost,
    {
      createComponent({ name }) {
        const descriptor = registry.get(name === canvasId(pageId) ? CANVAS : name)
        let rendererDisposed = false
        let panelDisposer: (() => void) | undefined
        const release = (): void => {
          if (rendererDisposed) return
          rendererDisposed = true
          panelDisposer?.()
          if (disposers.get(name) === release) disposers.delete(name)
        }
        const renderer: IContentRenderer = {
          element: document.createElement("div"),
          init() {
            const containerElement = renderer.element
            containerElement.className = "composeui-editor__dockview-panel"
            if (descriptor === undefined) {
              errorPanel(containerElement, "面板不可用", `无法加载 ${name}。`)
              events({
                type: "panel-failure",
                panelId: name,
                error: new Error(`Unknown panel: ${name}`),
              })
              return
            }
            const contextApi: WorkspaceCommandApi = {
              execute(command) {
                void api.execute(command)
              },
              undo: api.undo,
              redo: api.redo,
              openPanel: (id) => {
                api.openPanel(id)
              },
              closePanel: (id) => {
                api.closePanel(id)
              },
              resetLayout: api.resetLayout,
            }
            const context: WorkspaceContext = {
              editor,
              session,
              pageId,
              api: contextApi,
              emit: events,
              ...(options.resources === undefined ? {} : { resources: options.resources }),
              ...(options.operationLog === undefined ? {} : { operationLog: options.operationLog }),
            }
            try {
              if (descriptor.id === CANVAS) {
                const canvasPanel = document.createElement("div")
                canvasPanel.className = "composeui-editor__canvas-panel"
                const toolbarRoot = document.createElement("nav")
                const canvasRoot = document.createElement("div")
                canvasRoot.className = "composeui-editor__canvas-panel-body"
                canvasPanel.append(toolbarRoot, canvasRoot)
                containerElement.replaceChildren(canvasPanel)
                const disposeToolbar = mountWorkspaceToolbar(toolbarRoot, {
                  editor,
                  session,
                  api: {
                    undo: () => editor.undo(),
                    redo: () => editor.redo(),
                    openPanel: (id) => {
                      return api.openPanel(id)
                    },
                  },
                  panels: [...registry.values()],
                })
                const disposeToolbarExtras = toToolbarExtrasDisposer(
                  options.mountToolbarExtras?.(toolbarRoot),
                )
                const disposeCanvas = toDisposer(descriptor.mount(canvasRoot, context))
                panelDisposer = () => {
                  disposeCanvas?.()
                  disposeToolbarExtras?.()
                  disposeToolbar()
                }
              } else if (descriptor.id === "scene") {
                const disposeScene = toDisposer(descriptor.mount(containerElement, context))
                const disposeSceneExtras = toToolbarExtrasDisposer(
                  options.mountSceneExtras?.(containerElement),
                )
                panelDisposer = () => {
                  disposeSceneExtras?.()
                  disposeScene?.()
                }
              } else {
                panelDisposer = toDisposer(descriptor.mount(containerElement, context))
              }
              if (panelDisposer !== undefined) disposers.set(name, release)
            } catch (error) {
              if (descriptor.id === CANVAS) errorPanel(containerElement, "画布不可用", CANVAS_ERROR)
              else errorPanel(containerElement, descriptor.title, `无法加载${descriptor.title}。`)
              events({ type: "panel-failure", panelId: descriptor.id, error })
            }
          },
          dispose: release,
        }
        return renderer
      },
      createTabComponent({ name }) {
        return name === NON_CLOSABLE_TAB ? createNonClosableTab() : undefined
      },
    },
  )

  let layoutSubscription: { dispose(): void } | undefined

  const addPanel = (id: string): void => {
    const actualId = panelId(id, pageId)
    if (dockview.getPanel(actualId) !== undefined) return
    const descriptor = registry.get(id)
    if (descriptor === undefined) return
    const optionsForPanel: AddPanelOptions = {
      id: actualId,
      component: actualId,
      title: descriptor.title,
      ...(descriptor.closable ? {} : { tabComponent: NON_CLOSABLE_TAB }),
      inactive: actualId !== "scene" && actualId !== canvasId(pageId),
      ...(descriptor.defaultSize === undefined
        ? {}
        : descriptor.defaultPosition === "left" || descriptor.defaultPosition === "right"
          ? { initialWidth: descriptor.defaultSize }
          : { initialHeight: descriptor.defaultSize }),
    }
    if (actualId === canvasId(pageId)) {
      // Canvas is the anchor for the Godot-style default layout.
      optionsForPanel.minimumWidth = 320
      optionsForPanel.minimumHeight = 500
    } else if (actualId === "scene") {
      optionsForPanel.position = { direction: "left", referencePanel: canvasId(pageId) }
      optionsForPanel.initialWidth = 280
      optionsForPanel.minimumWidth = 220
      optionsForPanel.maximumWidth = 320
      optionsForPanel.minimumHeight = 500
    } else if (actualId === "resources") {
      optionsForPanel.position = { direction: "below", referencePanel: "scene" }
      optionsForPanel.initialHeight = 280
      optionsForPanel.minimumWidth = 220
      optionsForPanel.maximumWidth = 320
      optionsForPanel.minimumHeight = 120
    } else if (actualId === "history") {
      optionsForPanel.position = { referencePanel: "resources" }
      optionsForPanel.minimumWidth = 220
      optionsForPanel.maximumWidth = 320
      optionsForPanel.minimumHeight = 120
    } else if (actualId === "inspector") {
      optionsForPanel.position = { direction: "right", referencePanel: canvasId(pageId) }
      optionsForPanel.initialWidth = 300
      optionsForPanel.minimumWidth = 240
      optionsForPanel.maximumWidth = 320
    } else if (actualId === "signals") {
      optionsForPanel.position = { referencePanel: "inspector" }
      optionsForPanel.minimumWidth = 240
      optionsForPanel.maximumWidth = 320
    } else if (actualId === "output") {
      optionsForPanel.position = { direction: "below", referencePanel: canvasId(pageId) }
      optionsForPanel.initialHeight = 220
      optionsForPanel.minimumHeight = 120
      optionsForPanel.maximumHeight = 360
    } else if (descriptor.defaultPosition === "bottom") {
      optionsForPanel.position = { direction: "below", referencePanel: canvasId(pageId) }
    } else if (descriptor.defaultPosition === "right") {
      optionsForPanel.position = { direction: "right", referencePanel: canvasId(pageId) }
    } else {
      optionsForPanel.position = { direction: "below", referencePanel: "scene" }
    }
    dockview.addPanel(optionsForPanel)
  }

  const defaultPanelIds = [
    CANVAS,
    "scene",
    "resources",
    "history",
    "inspector",
    "signals",
    "output",
  ]

  const applyDefaultLayout = (): void => {
    const wasApplyingLayout = applyingLayout
    applyingLayout = true
    try {
      dockview.clear?.()
      for (const id of defaultPanelIds) addPanel(id)
    } finally {
      applyingLayout = wasApplyingLayout
    }
  }

  const api: EditorWorkspaceApi = {
    execute(command) {
      if (command.type === "open-panel") {
        api.openPanel(command.panelId)
        return
      }
      if (command.type === "close-panel") {
        api.closePanel(command.panelId)
        return
      }
      if (command.type === "reset-layout") return api.resetLayout()
      if (command.type === "undo") {
        editor.undo()
        return
      }
      if (command.type === "redo") {
        editor.redo()
        return
      }
    },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    openPanel(id) {
      const actualId = panelId(id, pageId)
      if (isCanvas(id) || registry.has(id)) {
        layoutDirty = true
        addPanel(id)
        return dockview.getPanel(actualId) !== undefined
      }
      return false
    },
    closePanel(id) {
      const actualId = panelId(id, pageId)
      const descriptor = registry.get(isCanvas(id) ? CANVAS : id)
      if (descriptor === undefined || !descriptor.closable) return false
      const panel = dockview.getPanel(actualId)
      if (panel === undefined) return false
      layoutDirty = true
      dockview.removePanel(panel)
      return true
    },
    focusPanel(id) {
      dockview.getPanel(panelId(id, pageId))?.focus?.()
    },
    resetLayout: async () => {
      try {
        await options.layoutStore?.remove()
      } catch (error) {
        events({ type: "layout-failure", operation: "remove", error })
      }
      layoutDirty = true
      applyDefaultLayout()
    },
  }

  applyDefaultLayout()
  const onLayoutChange = (): void => {
    if (options.layoutStore === undefined || disposed) return
    if (applyingLayout) return
    layoutDirty = true
    void Promise.resolve()
      .then(() =>
        options.layoutStore!.save({ version: 1, modeId: "2d", layout: dockview.toJSON() }),
      )
      .catch((error) => {
        events({ type: "layout-failure", operation: "save", error })
      })
  }
  if (typeof dockview.onDidLayoutChange === "function") {
    layoutSubscription = dockview.onDidLayoutChange(onLayoutChange)
  } else if (dockview.onDidLayoutChange !== undefined) {
    layoutSubscription = dockview.onDidLayoutChange.subscribe(onLayoutChange)
  }

  void Promise.resolve()
    .then(() => options.layoutStore?.load())
    .then(
      (stored) => {
        if (disposed || stored === undefined || layoutDirty) return
        const layout = replaceCanvasIds(stored.layout, pageId)
        if (!containsPanel(layout, canvasId(pageId))) return
        const wasApplyingLayout = applyingLayout
        applyingLayout = true
        try {
          dockview.fromJSON(layout)
          if (dockview.getPanel(canvasId(pageId)) === undefined) {
            events({
              type: "layout-failure",
              operation: "load",
              error: new Error(`Restored layout is missing ${canvasId(pageId)}`),
            })
            applyDefaultLayout()
          }
        } catch (error) {
          events({ type: "layout-failure", operation: "load", error })
          applyDefaultLayout()
        } finally {
          applyingLayout = wasApplyingLayout
        }
      },
      (error) => {
        if (!disposed) events({ type: "layout-failure", operation: "load", error })
      },
    )

  return {
    session,
    api,
    dispose() {
      if (disposed) return
      disposed = true
      layoutSubscription?.dispose()
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
      dockview.dispose()
      root.replaceChildren()
    },
  }
}
