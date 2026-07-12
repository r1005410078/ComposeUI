// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import {
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
}

function createDockviewFake(initialLayout: unknown = { panels: [] }): {
  factory: DockviewFactory
  dockview: EditorWorkspaceDockview
  panels: Map<string, FakePanel>
  createComponent: (id: string, root: HTMLElement) => void
  triggerLayoutChange: () => void
} {
  const panels = new Map<string, FakePanel>()
  let layout = initialLayout
  let layoutListener: (() => void) | undefined
  let componentFactory:
    | ((options: { id: string; name: string }) => {
        init(params: { containerElement: HTMLElement }): void
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
      return panel
    },
    getPanel(id) {
      return panels.get(id)
    },
    removePanel(panel) {
      panels.delete(panel.id)
    },
    toJSON() {
      return layout
    },
    fromJSON: vi.fn((nextLayout) => {
      layout = nextLayout
    }),
    dispose: vi.fn(),
  }
  const factory: DockviewFactory = (root, options) => {
    root.dataset.testid = "dockview-root"
    componentFactory = options.createComponent
    return dockview
  }
  return {
    factory,
    dockview,
    panels,
    createComponent(id, root) {
      componentFactory?.({ id, name: id }).init({ containerElement: root })
    },
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
      "scene",
      "resources",
      "history",
      "canvas:page-1",
      "inspector",
      "signals",
      "output",
      "debugger",
      "animation",
      "shader-editor",
    ])
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

  it("falls back when restore rejects a stale or invalid layout", async () => {
    const fake = createDockviewFake({
      root: { panels: [{ id: "canvas:old-page", component: "canvas:old-page" }] },
    })
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
    expect(mounted.session).toBeDefined()
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

    const historyRoot = document.createElement("div")
    fake.createComponent("history", historyRoot)
    const canvasRoot = document.createElement("div")
    fake.createComponent("canvas:page-1", canvasRoot)

    expect(historyRoot.textContent).toContain("Unable to load History")
    expect(canvasRoot.textContent).toContain("Canvas unavailable")
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
