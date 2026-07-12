import {
  createDockview,
  type AddPanelOptions,
  type IContentRenderer,
  type ITabRenderer,
} from "dockview"
import type { Editor } from "@composeui/core"
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
  readonly onDidLayoutChange?: { subscribe(listener: () => void): { dispose(): void } }
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
  layoutStore?: WorkspaceLayoutStore
  resources?: WorkspaceResourceService
  panelRegistry?: PanelRegistry | WorkspacePanelRegistry
  modeRegistry?: ModeRegistry
  createDockview?: DockviewFactory
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
const CANVAS_ERROR = "Canvas unavailable."
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
  root.style.setProperty("--composeui-workspace-min-width", "480px")
  root.style.setProperty("--composeui-workspace-min-height", "320px")
  const shell = document.createElement("div")
  shell.className = "composeui-editor__workspace-shell"
  const header = document.createElement("header")
  header.className = "composeui-editor__workspace-header"
  const dockviewHost = document.createElement("div")
  dockviewHost.className = "composeui-editor__dockview-host"
  shell.append(header, dockviewHost)
  root.replaceChildren(shell)

  if (modeRegistry.shouldRenderModeBar()) {
    const modeBar = document.createElement("nav")
    modeBar.className = "composeui-editor__mode-bar"
    modeBar.dataset.testid = "workspace-mode-bar"
    modeBar.setAttribute("aria-label", "Editor modes")
    for (const mode of modeRegistry.all()) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = mode.title
      button.dataset.modeId = mode.id
      button.disabled = true
      if (mode.id === "2d") button.setAttribute("aria-current", "page")
      modeBar.append(button)
    }
    header.append(modeBar)
  }

  const toolbarRoot = document.createElement("nav")
  header.append(toolbarRoot)
  const toolbarDispose = mountWorkspaceToolbar(toolbarRoot, {
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
            if (descriptor === undefined) {
              errorPanel(containerElement, "Panel unavailable", `Unable to load ${name}.`)
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
            }
            try {
              panelDisposer = toDisposer(descriptor.mount(containerElement, context))
              if (panelDisposer !== undefined) disposers.set(name, release)
            } catch (error) {
              if (descriptor.id === CANVAS)
                errorPanel(containerElement, "Canvas unavailable", CANVAS_ERROR)
              else
                errorPanel(
                  containerElement,
                  descriptor.title,
                  `Unable to load ${descriptor.title}.`,
                )
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
    if (actualId === "scene") optionsForPanel.position = { direction: "left" }
    else if (actualId === canvasId(pageId)) optionsForPanel.position = { direction: "right" }
    else if (descriptor.defaultPosition === "bottom") {
      optionsForPanel.position = { direction: "below", referencePanel: canvasId(pageId) }
    } else if (descriptor.defaultPosition === "right") {
      optionsForPanel.position = { direction: "right", referencePanel: canvasId(pageId) }
    } else {
      optionsForPanel.position = { direction: "below", referencePanel: "scene" }
    }
    dockview.addPanel(optionsForPanel)
  }

  const defaultPanelIds = [
    "scene",
    "resources",
    "history",
    CANVAS,
    "inspector",
    "signals",
    "output",
    "debugger",
    "animation",
    "shader-editor",
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
  if (dockview.onDidLayoutChange !== undefined) {
    layoutSubscription = dockview.onDidLayoutChange.subscribe(() => {
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
    })
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
      toolbarDispose()
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
      dockview.dispose()
      root.replaceChildren()
    },
  }
}
