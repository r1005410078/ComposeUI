// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import {
  createModeRegistry,
  mountEditorWorkspace,
  type DockviewFactory,
  type EditorWorkspaceDockview,
} from "../src/index"
import type {
  StoredWorkspaceLayout,
  WorkspacePanelDescriptor,
  WorkspacePanelRegistry,
} from "../src/index"

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
  }
}

function createEditorInstance() {
  return createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
}

describe("editor workspace", () => {
  it("creates the deterministic ten-panel 2D shell and protects Canvas", () => {
    const fake = createDockviewFake()
    const root = document.createElement("div")

    const mounted = mountEditorWorkspace(root, createEditorInstance(), {
      pageId: "page-1",
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
      "debugger",
      "animation",
      "shader-editor",
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
      expect(fake.panelOptions.get(id)?.position).toEqual({ referencePanel: "output" })
    }
    expect(mounted.api.closePanel("canvas:page-1")).toBe(false)
    expect(root.querySelector("[data-testid='workspace-mode-bar']")).toBeNull()
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
          title: "History",
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
          title: "History",
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

  it("closes and reopens a panel through the mounted toolbar menu", () => {
    const mount = vi.fn(() => dispose)
    const dispose = vi.fn()
    const registry: WorkspacePanelRegistry = {
      all: () => [
        {
          id: "history",
          title: "History",
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
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-panel-menu']")!.click()
    root.querySelector<HTMLButtonElement>("[data-panel-id='history']")!.click()
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
    expect(fake.panels.size).toBe(10)
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
            title: "Canvas",
            closable: false,
            defaultPosition: "center",
            mount: () => {
              throw new Error("canvas failed")
            },
          },
          {
            id: "history",
            title: "History",
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

    expect(historyRoot?.textContent).toContain("Unable to load History")
    expect(canvasRoot?.textContent).toContain("Canvas unavailable")
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
      expect(events).toContainEqual({ type: "layout-failure", operation: "save", error: failure }),
    )
    mounted.dispose()
    mounted.dispose()
    expect(fake.dockview.dispose).toHaveBeenCalledTimes(1)
  })
})
