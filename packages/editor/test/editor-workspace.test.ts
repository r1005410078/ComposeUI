// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import {
  createModeRegistry,
  mountEditorWorkspace,
  ReplayController,
  type DockviewFactory,
  type EditorWorkspaceDockview,
  type SerializedWorkspaceEvent,
  type WorkspaceEvent,
  type WorkspaceError,
} from "../src/index"
import type {
  StoredWorkspaceLayout,
  WorkspaceContext,
  WorkspacePanelDescriptor,
  WorkspacePanelRegistry,
} from "../src/index"
import type { OperationLogControllerPort, OperationLogViewQuery } from "../src/index"
import { serializeWorkspaceError } from "../src/workspace/types"

type FakePanel = {
  id: string
  focus: ReturnType<typeof vi.fn>
  renderer?: {
    element: HTMLElement
    init(params: {
      params: Record<string, unknown>
      title: string
      api: object
      containerApi: object
    }): void
    dispose?(): void
  }
  tab?: {
    element: HTMLElement
    init(params: { title: string; api: object; containerApi: object; tabLocation: "header" }): void
    dispose?(): void
  }
}

function createDockviewFake(
  initialLayout: unknown = { panels: [] },
  restorePanelIds?: string[],
): {
  factory: DockviewFactory
  dockview: EditorWorkspaceDockview
  panels: Map<string, FakePanel>
  panelOptions: Map<
    string,
    {
      component: string
      tabComponent?: string
      position?: { direction?: string; referencePanel?: string }
      initialWidth?: number
      initialHeight?: number
    }
  >
  tabs: Map<string, HTMLElement>
  triggerLayoutChange: () => void
  triggerActivePanelChange: (panelId: string | undefined) => void
  setLayoutSnapshot: (layout: unknown) => void
} {
  const panels = new Map<string, FakePanel>()
  const panelOptions = new Map<
    string,
    {
      component: string
      tabComponent?: string
      position?: { direction?: string; referencePanel?: string }
      initialWidth?: number
      initialHeight?: number
    }
  >()
  const tabs = new Map<string, HTMLElement>()
  const tabList = document.createElement("div")
  tabList.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || (event.key !== "Delete" && event.key !== "Backspace")) return
    const entry = [...tabs.entries()].find(([, element]) => element === event.target)
    if (entry !== undefined) {
      const panel = panels.get(entry[0])
      if (panel !== undefined) dockview.removePanel(panel)
    }
  })
  let layout = initialLayout
  let layoutListener: (() => void) | undefined
  const activePanelListeners = new Set<(panel: { id: string } | undefined) => void>()
  let layoutSnapshot: unknown | undefined
  let componentFactory:
    | ((options: { id: string; name: string }) => {
        element: HTMLElement
        init(params: {
          params: Record<string, unknown>
          title: string
          api: object
          containerApi: object
        }): void
        dispose?(): void
      })
    | undefined
  let tabFactory:
    | ((options: { id: string; name: string }) => {
        element: HTMLElement
        init(params: {
          title: string
          api: object
          containerApi: object
          tabLocation: "header"
        }): void
        dispose?(): void
      })
    | undefined
  const dockview: EditorWorkspaceDockview = {
    onDidLayoutChange: {
      subscribe(listener: () => void) {
        layoutListener = listener
        return { dispose: vi.fn() }
      },
    },
    onDidActivePanelChange(listener) {
      activePanelListeners.add(listener)
      return { dispose: () => activePanelListeners.delete(listener) }
    },
    addPanel(options) {
      const panel = { id: options.id, focus: vi.fn() }
      panels.set(options.id, panel)
      panelOptions.set(options.id, {
        component: options.component,
        ...(options.tabComponent === undefined ? {} : { tabComponent: options.tabComponent }),
        ...(options.position === undefined ? {} : { position: options.position }),
        ...(options.initialWidth === undefined ? {} : { initialWidth: options.initialWidth }),
        ...(options.initialHeight === undefined ? {} : { initialHeight: options.initialHeight }),
      })
      const renderer = componentFactory?.({ id: options.id, name: options.component })
      if (renderer !== undefined) {
        panel.renderer = renderer
        renderer.init({
          params: options.params ?? {},
          title: options.title ?? "",
          api: {},
          containerApi: dockview,
        })
      }
      if (options.tabComponent !== undefined) {
        const tab = tabFactory?.({ id: options.id, name: options.tabComponent })
        if (tab !== undefined) {
          panel.tab = tab
          tabs.set(options.id, tab.element)
          tabList.append(tab.element)
          tab.init({
            title: options.title ?? "",
            api: {},
            containerApi: dockview,
            tabLocation: "header",
          })
        }
      }
      layoutListener?.()
      return panel
    },
    getPanel(id) {
      return panels.get(id)
    },
    removePanel(panel) {
      const current = panels.get(panel.id)
      current?.renderer?.dispose?.()
      current?.tab?.dispose?.()
      current?.tab?.element.remove()
      panels.delete(panel.id)
      panelOptions.delete(panel.id)
      tabs.delete(panel.id)
      layoutListener?.()
    },
    clear: vi.fn(() => {
      for (const panel of panels.values()) panel.renderer?.dispose?.()
      for (const panel of panels.values()) panel.tab?.dispose?.()
      panels.clear()
      panelOptions.clear()
      tabList.replaceChildren()
      tabs.clear()
      layoutListener?.()
    }),
    toJSON() {
      if (layoutSnapshot !== undefined) return layoutSnapshot
      return {
        panels: [...panels.keys()].map((id) => ({
          id,
          component: panelOptions.get(id)?.component ?? id,
        })),
      }
    },
    fromJSON: vi.fn((nextLayout) => {
      layout = nextLayout
      if (restorePanelIds !== undefined) {
        for (const panel of panels.values()) panel.renderer?.dispose?.()
        for (const panel of panels.values()) panel.tab?.dispose?.()
        panels.clear()
        panelOptions.clear()
        tabList.replaceChildren()
        tabs.clear()
        for (const id of restorePanelIds) dockview.addPanel({ id, component: id, title: id })
      }
      layoutListener?.()
    }),
    dispose: vi.fn(() => {
      for (const panel of panels.values()) panel.renderer?.dispose?.()
      for (const panel of panels.values()) panel.tab?.dispose?.()
      panels.clear()
      panelOptions.clear()
      tabList.replaceChildren()
      tabs.clear()
    }),
  }
  const factory: DockviewFactory = (root, options) => {
    root.dataset.testid = "dockview-root"
    root.append(tabList)
    componentFactory = options.createComponent
    tabFactory = options.createTabComponent
    return dockview
  }
  void layout
  return {
    factory,
    dockview,
    panels,
    panelOptions,
    tabs,
    triggerLayoutChange() {
      layoutListener?.()
    },
    triggerActivePanelChange(panelId) {
      const panel = panelId === undefined ? undefined : panels.get(panelId)
      activePanelListeners.forEach((listener) => listener({ panel }))
    },
    setLayoutSnapshot(nextLayout) {
      layoutSnapshot = nextLayout
    },
  }
}

function createEditorInstance() {
  return createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
}

describe("editor workspace", () => {
  it("keeps legacy workspace failure producers type-compatible", () => {
    const event: WorkspaceEvent = {
      type: "panel-failure",
      panelId: "resources",
      error: new Error("legacy producer"),
    }

    expect(event.error).toBeInstanceOf(Error)
  })

  it("exports serialized workspace event types for onEvent adapters", () => {
    const error: WorkspaceError = { name: "Error", message: "serialized" }
    const event: SerializedWorkspaceEvent = {
      type: "layout-failure",
      operation: "save",
      error,
    }

    expect(event.error).toEqual(error)
  })

  it("serializes errors without retaining unsafe values", () => {
    const error = new Proxy(
      {},
      {
        get() {
          throw new Error("unreadable")
        },
      },
    )

    expect(serializeWorkspaceError(error)).toEqual({ name: "Error", message: "Unknown error" })
  })

  it("disables save and run while isolated replay is active", async () => {
    const replayController = new ReplayController({
      createEngine: vi.fn(async () => ({
        runTo: vi.fn(async () => ({
          status: "paused" as const,
          deterministic: true,
          startedAtSequence: 0,
          currentSequence: 1,
          targetSequence: 1,
        })),
        step: vi.fn(),
        verify: vi.fn(),
        continueBestEffort: vi.fn(),
        getState: vi.fn(() => ({})),
      })),
    })
    const operationLog: OperationLogControllerPort = {
      query: async () => [],
      subscribe: () => () => undefined,
      exportSession: async () => "",
      importBundle: async () => undefined,
      startReplay: () => undefined,
      replayController,
    }
    const root = document.createElement("div")
    const mounted = mountEditorWorkspace(root, createEditorInstance(), {
      pageId: "page-1",
      operationLog,
      createDockview: createDockviewFake().factory,
    })

    const run = root.querySelector<HTMLButtonElement>('[data-testid="workspace-run"]')!
    const save = root.querySelector<HTMLButtonElement>('[data-testid="workspace-save"]')!
    expect(run.disabled).toBe(false)
    expect(save.disabled).toBe(false)
    await replayController.start(1)
    expect(run.disabled).toBe(true)
    expect(save.disabled).toBe(true)
    replayController.stop()
    expect(run.disabled).toBe(false)
    expect(save.disabled).toBe(false)
    mounted.dispose()
  })

  it("passes the operation log controller unchanged to first-party panels", () => {
    let capturedContext: WorkspaceContext | undefined
    const operationLog: OperationLogControllerPort = {
      query: async (_query: OperationLogViewQuery) => [],
      subscribe: () => () => undefined,
      exportSession: async () => "",
      importBundle: async (_serialized: string) => undefined,
      startReplay: (_sequence: number) => undefined,
    }
    const registry: WorkspacePanelRegistry = {
      all: () => [
        {
          id: "context-probe",
          title: "Context Probe",
          closable: true,
          defaultPosition: "bottom",
          mount: (_root, context) => {
            capturedContext = context
          },
        } satisfies WorkspacePanelDescriptor,
      ],
    }
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      operationLog,
      panelRegistry: registry,
      createDockview: createDockviewFake().factory,
    })

    expect(mounted.api.openPanel("context-probe")).toBe(true)
    expect(capturedContext?.operationLog).toBe(operationLog)
    mounted.dispose()
  })

  it("creates the deterministic seven-panel 2D shell and protects 画布", () => {
    const fake = createDockviewFake()
    const root = document.createElement("div")

    const mounted = mountEditorWorkspace(root, createEditorInstance(), {
      pageId: "page-1",
      projectTitle: "BMS",
      mountSceneExtras(sceneRoot) {
        const button = document.createElement("button")
        button.dataset.testid = "scene-extra"
        sceneRoot.querySelector(".composeui-editor__component-tree")?.prepend(button)
      },
      createDockview: fake.factory,
    })

    expect([...fake.panels.keys()]).toEqual([
      "canvas:page-1",
      "scene",
      "resources",
      "history",
      "inspector",
      "signals",
      "output",
    ])
    expect(fake.panelOptions.get("scene")).toMatchObject({
      position: { direction: "left", referencePanel: "canvas:page-1" },
      initialWidth: 280,
    })
    expect(fake.panelOptions.get("resources")).toMatchObject({
      position: { direction: "below", referencePanel: "scene" },
      initialHeight: 280,
    })
    expect(fake.panelOptions.get("history")?.position).toEqual({ referencePanel: "resources" })
    expect(fake.panelOptions.get("inspector")).toMatchObject({
      position: { direction: "right", referencePanel: "canvas:page-1" },
      initialWidth: 300,
    })
    expect(fake.panelOptions.get("signals")?.position).toEqual({ referencePanel: "inspector" })
    expect(fake.panelOptions.get("output")).toMatchObject({
      position: { direction: "below", referencePanel: "canvas:page-1" },
      initialHeight: 220,
    })
    for (const id of ["debugger", "animation", "shader-editor"]) {
      expect(fake.panels.has(id)).toBe(false)
    }
    expect(mounted.api.closePanel("canvas:page-1")).toBe(false)
    expect(root.querySelector("[data-testid='workspace-mode-bar']")).toBeNull()
    expect(root.querySelector("[data-testid='workspace-project-title']")?.textContent).toBe("BMS")
    expect(root.querySelector("[data-testid='workspace-run']")).not.toBeNull()
    expect(root.querySelector("[data-testid='workspace-save']")).not.toBeNull()
    expect(
      root.querySelector(".composeui-editor__workspace-header .composeui-editor__toolbar"),
    ).toBeNull()
    expect(
      fake.panels
        .get("canvas:page-1")
        ?.renderer?.element.querySelector(".composeui-editor__toolbar"),
    ).not.toBeNull()
    expect(
      fake.panels.get("scene")?.renderer?.element.querySelector("[data-testid='scene-extra']"),
    ).not.toBeNull()
  })

  it("reopens auxiliary panels and focuses them through the public API", () => {
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      createDockview: fake.factory,
    })

    expect(mounted.api.closePanel("resources")).toBe(true)
    expect(fake.panels.has("resources")).toBe(false)
    expect(mounted.api.openPanel("resources")).toBe(true)
    mounted.api.focusPanel("resources")
    expect(fake.panels.get("resources")?.focus).toHaveBeenCalledTimes(1)
  })

  it("keeps destructured API methods bound to the mounted workspace", () => {
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      createDockview: fake.factory,
    })
    const { execute, openPanel, closePanel, focusPanel } = mounted.api

    expect(closePanel("resources")).toBe(true)
    expect(openPanel("resources")).toBe(true)
    focusPanel("resources")
    execute({ type: "close-panel", panelId: "resources" })
    expect(fake.panels.has("resources")).toBe(false)
    expect(fake.dockview.toJSON()).toEqual({
      panels: expect.not.arrayContaining([{ id: "resources", component: "resources" }]),
    })
  })

  it("enforces descriptor closable and hides Dockview close affordance", () => {
    const registry: WorkspacePanelRegistry = {
      all: () => [
        {
          id: "history",
          title: "历史",
          closable: false,
          defaultPosition: "bottom",
          mount: () => undefined,
        },
      ],
    }
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      panelRegistry: registry,
      createDockview: fake.factory,
    })

    expect(mounted.api.closePanel("history")).toBe(false)
    expect(fake.panels.has("history")).toBe(true)
    expect(fake.panelOptions.get("history")?.tabComponent).toBe("workspace-non-closable-tab")
  })

  it("allows Scene to close through the workspace API", () => {
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      createDockview: fake.factory,
    })

    expect(mounted.api.closePanel("scene")).toBe(true)
    expect(fake.panels.has("scene")).toBe(false)
  })

  it("disposes each mounted panel exactly once across close and reopen", () => {
    const dispose = vi.fn()
    const registry: WorkspacePanelRegistry = {
      all: () => [
        {
          id: "history",
          title: "历史",
          closable: true,
          defaultPosition: "bottom",
          mount: () => dispose,
        },
      ],
    }
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      panelRegistry: registry,
      createDockview: fake.factory,
    })

    expect(mounted.api.closePanel("history")).toBe(true)
    expect(mounted.api.openPanel("history")).toBe(true)
    mounted.dispose()

    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("closes and reopens a panel through the public workspace API", () => {
    const mount = vi.fn(() => dispose)
    const dispose = vi.fn()
    const registry: WorkspacePanelRegistry = {
      all: () => [
        {
          id: "history",
          title: "历史",
          closable: true,
          defaultPosition: "bottom",
          mount,
        },
      ],
    }
    const fake = createDockviewFake()
    const root = document.createElement("div")
    const mounted = mountEditorWorkspace(root, createEditorInstance(), {
      pageId: "page-1",
      panelRegistry: registry,
      createDockview: fake.factory,
    })

    expect(mount).toHaveBeenCalledTimes(1)
    expect(mounted.api.closePanel("history")).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    const canvas = fake.panels.get("canvas:page-1")?.renderer?.element
    expect(canvas?.querySelector("[data-testid='workspace-panel-menu']")).toBeNull()
    expect(mounted.api.openPanel("history")).toBe(true)
    expect(fake.panels.has("history")).toBe(true)
    expect(mount).toHaveBeenCalledTimes(2)
    mounted.dispose()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("falls back when restore rejects a stale or invalid layout", async () => {
    const fake = createDockviewFake(
      { root: { panels: [{ id: "canvas:old-page", component: "canvas:old-page" }] } },
      ["scene"],
    )
    const layoutStore = {
      load: vi.fn().mockResolvedValue({
        version: 1,
        modeId: "2d",
        layout: { panels: [{ id: "canvas:old-page", component: "canvas:old-page" }] },
      } satisfies StoredWorkspaceLayout),
      save: vi.fn(),
      remove: vi.fn(),
    }
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-2",
      layoutStore,
      createDockview: fake.factory,
    })

    await vi.waitFor(() => expect(layoutStore.load).toHaveBeenCalledTimes(1))
    expect(fake.dockview.fromJSON).toHaveBeenCalledWith({
      panels: [{ id: "canvas:page-2", component: "canvas:page-2" }],
    })
    expect(fake.panels.has("canvas:page-2")).toBe(true)
    expect(fake.panels.size).toBe(7)
    expect(mounted.session).toBeDefined()
  })

  it("does not restore an async layout after the user changes the layout", async () => {
    let resolveLoad!: (layout: StoredWorkspaceLayout) => void
    const layoutStore = {
      load: vi.fn(
        () =>
          new Promise<StoredWorkspaceLayout>((resolve) => {
            resolveLoad = resolve
          }),
      ),
      save: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    }
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutStore,
      createDockview: fake.factory,
    })

    await vi.waitFor(() => expect(layoutStore.load).toHaveBeenCalled())
    expect(mounted.api.closePanel("resources")).toBe(true)
    resolveLoad({
      version: 1,
      modeId: "2d",
      layout: { panels: [{ id: "canvas:page-1", component: "canvas:page-1" }] },
    })
    await vi.waitFor(() => expect(layoutStore.save).toHaveBeenCalled())
    expect(fake.dockview.fromJSON).not.toHaveBeenCalled()
  })

  it("copies the supplied mode registry and renders a mode bar for multiple modes", () => {
    const modeRegistry = createModeRegistry()
    modeRegistry.register({
      id: "script",
      title: "Script",
      createLayout: () => undefined,
      toolbar: { items: [] },
    })
    const root = document.createElement("div")

    mountEditorWorkspace(root, createEditorInstance(), {
      pageId: "page-1",
      modeRegistry,
      createDockview: createDockviewFake().factory,
    })

    expect(modeRegistry.all().map((mode) => mode.id)).toEqual(["script"])
    expect(root.querySelector("[data-testid='workspace-mode-bar']")).not.toBeNull()
  })

  it("isolates auxiliary failures and blocks the Canvas failure", () => {
    const events: unknown[] = []
    const registry: WorkspacePanelRegistry = {
      all: () =>
        [
          {
            id: "canvas",
            title: "画布",
            closable: false,
            defaultPosition: "center",
            mount: () => {
              throw new Error("canvas failed")
            },
          },
          {
            id: "history",
            title: "历史",
            closable: true,
            defaultPosition: "bottom",
            mount: () => {
              throw new Error("history failed")
            },
          },
        ] satisfies WorkspacePanelDescriptor[],
    }
    const fake = createDockviewFake()
    const root = document.createElement("div")
    const mounted = mountEditorWorkspace(root, createEditorInstance(), {
      pageId: "page-1",
      panelRegistry: registry,
      createDockview: fake.factory,
      onEvent: (event) => events.push(event),
    })

    const historyRoot = fake.panels.get("history")?.renderer?.element
    const canvasRoot = fake.panels.get("canvas:page-1")?.renderer?.element

    expect(historyRoot?.textContent).toContain("无法加载历史")
    expect(canvasRoot?.textContent).toContain("画布不可用")
    expect(events).toHaveLength(2)
    expect(mounted.session).toBeDefined()
  })

  it("reports save failures and disposes the Dockview shell only once", async () => {
    const fake = createDockviewFake()
    const failure = new Error("quota exceeded")
    const layoutStore = {
      load: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockRejectedValue(failure),
      remove: vi.fn(),
    }
    const events: unknown[] = []
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutStore,
      createDockview: fake.factory,
      onEvent: (event) => events.push(event),
    })

    fake.triggerLayoutChange()
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "layout-failure",
        operation: "save",
        error: { name: "Error", message: "quota exceeded" },
      }),
    )
    mounted.dispose()
    mounted.dispose()
    expect(fake.dockview.dispose).toHaveBeenCalledTimes(1)
  })

  it("emits panel events only for real open, close, and activation transitions", () => {
    const fake = createDockviewFake()
    const events: unknown[] = []
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      createDockview: fake.factory,
      onEvent: (event) => events.push(event),
    })

    expect(mounted.api.openPanel("resources")).toBe(false)
    expect(mounted.api.closePanel("resources")).toBe(true)
    expect(mounted.api.closePanel("resources")).toBe(false)
    expect(mounted.api.openPanel("resources")).toBe(true)
    fake.triggerActivePanelChange("resources")
    fake.triggerActivePanelChange("resources")
    fake.triggerActivePanelChange("scene")

    expect(events).toEqual([
      { type: "panel-closed", panelId: "resources" },
      { type: "panel-opened", panelId: "resources" },
      { type: "panel-activated", panelId: "resources" },
      { type: "panel-activated", panelId: "scene" },
    ])
    mounted.dispose()
    const eventCountAfterDispose = events.length
    fake.triggerActivePanelChange("resources")
    expect(events).toHaveLength(eventCountAfterDispose)
  })

  it("coalesces layout events and flushes the final cloneable snapshot", async () => {
    vi.useFakeTimers()
    try {
      const fake = createDockviewFake()
      const layoutStore = {
        load: vi.fn().mockResolvedValue(undefined),
        save: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      }
      const events: unknown[] = []
      const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
        pageId: "page-1",
        layoutStore,
        layoutChangeDelayMs: 150,
        createDockview: fake.factory,
        onEvent: (event) => events.push(event),
      })

      fake.setLayoutSnapshot({ revision: 1 })
      fake.triggerLayoutChange()
      fake.setLayoutSnapshot({ revision: 2 })
      fake.triggerLayoutChange()
      fake.setLayoutSnapshot({ revision: 3 })
      fake.triggerLayoutChange()
      await vi.advanceTimersByTimeAsync(149)
      expect(events).toEqual([])
      await vi.advanceTimersByTimeAsync(1)

      const snapshot = { version: 1, modeId: "2d", layout: { revision: 3 } }
      expect(events).toEqual([{ type: "layout-changed", layout: snapshot }])
      expect(layoutStore.save).toHaveBeenCalledWith(snapshot)
      expect(() => structuredClone(events[0])).not.toThrow()

      fake.setLayoutSnapshot({ revision: 4 })
      fake.triggerLayoutChange()
      expect(mounted.api.getLayoutSnapshot()).toEqual({
        version: 1,
        modeId: "2d",
        layout: { revision: 4 },
      })
      await mounted.api.flushLayout()
      expect(events).toContainEqual({
        type: "layout-changed",
        layout: { version: 1, modeId: "2d", layout: { revision: 4 } },
      })
      fake.setLayoutSnapshot({ revision: 5 })
      fake.triggerLayoutChange()
      mounted.dispose()
      await vi.advanceTimersByTimeAsync(150)
      expect(events).toContainEqual({
        type: "layout-changed",
        layout: { version: 1, modeId: "2d", layout: { revision: 5 } },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("emits cloneable layout lifecycle and failure events", async () => {
    const failure = Object.assign(new Error("quota exceeded"), { code: "QUOTA" })
    const fake = createDockviewFake(
      { panels: [{ id: "canvas:page-1", component: "canvas:page-1" }] },
      ["canvas:page-1"],
    )
    const layoutStore = {
      load: vi.fn().mockResolvedValue({
        version: 1,
        modeId: "2d",
        layout: { panels: [{ id: "canvas:page-1", component: "canvas:page-1" }] },
      } satisfies StoredWorkspaceLayout),
      save: vi.fn().mockRejectedValue(failure),
      remove: vi.fn().mockRejectedValue(failure),
    }
    const events: unknown[] = []
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutStore,
      createDockview: fake.factory,
      onEvent: (event) => events.push(event),
    })

    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: "layout-loaded" })))
    await mounted.api.resetLayout()
    fake.triggerLayoutChange()
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "layout-failure",
        operation: "save",
        error: { name: "Error", message: "quota exceeded", code: "QUOTA" },
      }),
    )
    expect(events).toContainEqual(expect.objectContaining({ type: "layout-reset" }))
    expect(events).toContainEqual({
      type: "layout-failure",
      operation: "remove",
      error: { name: "Error", message: "quota exceeded", code: "QUOTA" },
    })
    for (const event of events) expect(() => structuredClone(event)).not.toThrow()
    mounted.dispose()
  })

  it("serializes layout saves so an older save cannot finish after a newer snapshot", async () => {
    let resolveFirstSave!: () => void
    let resolveSecondSave!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (save.mock.calls.length === 1) resolveFirstSave = resolve
          else resolveSecondSave = resolve
        }),
    )
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutStore: { load: vi.fn().mockResolvedValue(undefined), save, remove: vi.fn() },
      createDockview: fake.factory,
    })

    fake.setLayoutSnapshot({ revision: 1 })
    fake.triggerLayoutChange()
    const firstFlush = mounted.api.flushLayout()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    fake.setLayoutSnapshot({ revision: 2 })
    fake.triggerLayoutChange()
    const secondFlush = mounted.api.flushLayout()
    expect(save).toHaveBeenCalledTimes(1)

    resolveFirstSave()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    resolveSecondSave()
    await Promise.all([firstFlush, secondFlush])
    expect(save.mock.calls.map(([layout]) => layout.layout)).toEqual([{ revision: 1 }, { revision: 2 }])
    mounted.dispose()
  })

  it("fences pending saves before resetting the stored layout", async () => {
    let resolveSave!: () => void
    let resolveRemove!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve
        }),
    )
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutStore: { load: vi.fn().mockResolvedValue(undefined), save, remove },
      createDockview: fake.factory,
    })

    fake.setLayoutSnapshot({ revision: "before-reset" })
    fake.triggerLayoutChange()
    void mounted.api.flushLayout()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    fake.setLayoutSnapshot({ revision: "pending-before-reset" })
    fake.triggerLayoutChange()
    const reset = mounted.api.resetLayout()
    expect(remove).not.toHaveBeenCalled()

    resolveSave()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    resolveRemove()
    await reset
    await mounted.api.flushLayout()
    expect(save).toHaveBeenCalledTimes(1)
    mounted.dispose()
  })

  it("flushes a pending layout during disposal and suppresses late save failures", async () => {
    let rejectSave!: (error: Error) => void
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    const fake = createDockviewFake()
    const events: unknown[] = []
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutChangeDelayMs: 10_000,
      layoutStore: { load: vi.fn().mockResolvedValue(undefined), save, remove: vi.fn() },
      createDockview: fake.factory,
      onEvent: (event) => events.push(event),
    })

    fake.setLayoutSnapshot({ revision: "dispose" })
    fake.triggerLayoutChange()
    mounted.dispose()
    const completion = mounted.api.flushLayout()
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ layout: { revision: "dispose" } })))
    rejectSave(new Error("late failure"))
    await completion
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "layout-failure", operation: "save" }),
    )
  })

  it("derives native panel closure from the structural layout callback", () => {
    const fake = createDockviewFake()
    const events: unknown[] = []
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      createDockview: fake.factory,
      onEvent: (event) => events.push(event),
    })

    fake.dockview.removePanel(fake.panels.get("resources")!)
    expect(events).toContainEqual({ type: "panel-closed", panelId: "resources" })
    mounted.dispose()
  })

  it("keeps layout changes suppressed until the final overlapping reset completes", async () => {
    const removeResolvers: Array<() => void> = []
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          removeResolvers.push(resolve)
        }),
    )
    const save = vi.fn().mockResolvedValue(undefined)
    const fake = createDockviewFake()
    const mounted = mountEditorWorkspace(document.createElement("div"), createEditorInstance(), {
      pageId: "page-1",
      layoutStore: { load: vi.fn().mockResolvedValue(undefined), save, remove },
      createDockview: fake.factory,
    })

    const firstReset = mounted.api.resetLayout()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    const secondReset = mounted.api.resetLayout()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
    removeResolvers[0]!()
    await firstReset

    fake.setLayoutSnapshot({ revision: "between-resets" })
    fake.triggerLayoutChange()
    await mounted.api.flushLayout()
    expect(save).not.toHaveBeenCalled()

    removeResolvers[1]!()
    await secondReset
    mounted.dispose()
  })
})
