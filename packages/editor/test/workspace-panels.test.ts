// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import { EditorSession } from "../src/index"
import type { WorkspaceContext } from "../src/workspace/types"
import { createWorkspacePanels, type PanelId } from "../src/workspace/panels"
import type { OperationLogControllerPort } from "../src/operation-log-controller-port"
import type { OperationLogControllerState } from "../src/operation-log-controller-port"
import type { OperationEvent } from "@composeui/operation-log"

function createContext(
  resources?: WorkspaceContext["resources"],
  operationLog?: WorkspaceContext["operationLog"],
): WorkspaceContext {
  const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
  editor.dispatch({
    id: "node.create",
    payload: {
      id: "node-1",
      parentId: "page-1",
      name: "Rectangle",
      x: 20,
      y: 30,
      width: 120,
      height: 80,
      fill: "#2563eb",
    },
  })
  return {
    editor,
    session: new EditorSession(),
    pageId: "page-1",
    resources,
    operationLog,
    api: {
      execute: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      resetLayout: vi.fn(),
    },
    emit: vi.fn(),
  }
}

function operationEvent(overrides: Partial<OperationEvent> = {}): OperationEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    sessionId: "session-1",
    projectId: "project-1",
    sequence: 1,
    timestamp: "2026-07-13T00:00:00.000Z",
    category: "document",
    type: "document.command",
    status: "succeeded",
    payload: {
      command: {
        id: "node.move",
        payload: { id: "node-1", delta: { x: 10, y: 20 } },
      },
    },
    ...overrides,
  }
}

function fakeOperationLogController(events: readonly OperationEvent[]): OperationLogControllerPort {
  const listeners = new Set<() => void>()
  const controller: OperationLogControllerPort = {
    query: vi.fn(async (query) =>
      events.filter(
        (event) =>
          (query.levels.length === 0 || query.levels.includes(event.status)) &&
          (query.categories.length === 0 || query.categories.includes(event.category)),
      ),
    ),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    exportSession: vi.fn(async () => "bundle"),
    importBundle: vi.fn(async () => undefined),
    startReplay: vi.fn(),
  }
  void listeners
  return controller
}

function panel(id: PanelId) {
  const descriptor = createWorkspacePanels().find((candidate) => candidate.id === id)
  if (descriptor === undefined) throw new Error(`Missing panel ${id}`)
  return descriptor
}

describe("workspace panel renderers", () => {
  it("mounts Scene and Canvas with the shared session", () => {
    const context = createContext()
    const sceneRoot = document.createElement("div")
    const canvasRoot = document.createElement("div")

    const disposeScene = panel("scene").mount(sceneRoot, context)
    const disposeCanvas = panel("canvas").mount(canvasRoot, context)

    expect(sceneRoot.querySelector("[aria-label='节点树']")).not.toBeNull()
    expect(canvasRoot.querySelector("[data-testid='page-board']")).not.toBeNull()
    context.session.setSelection(["node-1"])
    expect(canvasRoot.querySelector("[data-testid='selection-node-1']")).not.toBeNull()

    expect(() => {
      if (typeof disposeScene === "function") disposeScene()
      if (typeof disposeScene === "function") disposeScene()
      if (typeof disposeCanvas === "function") disposeCanvas()
      if (typeof disposeCanvas === "function") disposeCanvas()
    }).not.toThrow()
  })

  it("renders and updates the selected record in 检查器", () => {
    const context = createContext()
    const root = document.createElement("div")
    const dispose = panel("inspector").mount(root, context)

    context.session.setSelection(["node-1"])
    const nameInput = root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")
    expect(nameInput?.value).toBe("Rectangle")
    expect(root.querySelector("[data-testid='inspector-type']")?.textContent).toBe("node")

    nameInput!.value = "Renamed"
    nameInput!.dispatchEvent(new Event("change", { bubbles: true }))
    expect(context.editor.getRecord("node-1")).toMatchObject({ name: "Renamed" })
    expect(root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")?.value).toBe(
      "Renamed",
    )

    context.editor.undo()
    expect(root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")?.value).toBe(
      "Rectangle",
    )

    context.editor.redo()
    expect(root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")?.value).toBe(
      "Renamed",
    )

    if (typeof dispose === "function") {
      dispose()
      dispose()
    }
  })

  it("renders the history timeline without an action toolbar", () => {
    const context = createContext()
    const root = document.createElement("div")
    const dispose = panel("history").mount(root, context)

    expect(root.querySelector("[aria-label='历史']")).not.toBeNull()
    expect(root.querySelector(".composeui-editor__history > h2")).toBeNull()
    expect(root.querySelector("[data-testid='history-toolbar']")).toBeNull()
    expect(root.querySelector("[data-testid='history-undo']")).toBeNull()
    expect(root.querySelector("[data-testid='history-redo']")).toBeNull()
    expect(root.querySelectorAll("[data-testid='history-entry']")).toHaveLength(1)
    expect(root.querySelector(".composeui-editor__history-label")?.textContent).toContain(
      "node.create",
    )
    expect(root.querySelector(".composeui-editor__history-label")?.textContent).toContain(
      "x: 20, y: 30, width: 120, height: 80",
    )
    expect(root.querySelector("[data-testid='history-entry']")?.getAttribute("title")).toContain(
      "node.create",
    )
    expect(root.querySelector("[data-testid='history-entry']")?.getAttribute("data-current")).toBe(
      "true",
    )

    context.editor.undo()
    expect(context.editor.getRecord("node-1")).toBeUndefined()
    expect(root.querySelectorAll("[data-testid='history-entry']")).toHaveLength(1)
    expect(root.querySelector("[data-testid='history-entry']")?.getAttribute("data-future")).toBe(
      "true",
    )
    context.editor.redo()
    expect(context.editor.getRecord("node-1")).toBeDefined()

    if (typeof dispose === "function") dispose()
  })

  it("keeps the future history row aligned with dense history entries", () => {
    const context = createContext()
    const root = document.createElement("div")
    const dispose = panel("history").mount(root, context)

    context.editor.undo()

    const future = root.querySelector<HTMLElement>("[data-testid='history-entry']")
    expect(future?.textContent).toContain("1node.create")
    expect(future?.getAttribute("title")).toContain("node.create")
    expect(future?.getAttribute("data-current")).toBe("false")
    expect(future?.getAttribute("data-future")).toBe("true")

    if (typeof dispose === "function") dispose()
  })

  it("jumps to a clicked history entry while keeping the full timeline visible", () => {
    const context = createContext()
    context.editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-2",
        parentId: "page-1",
        name: "Second",
        x: 40,
        y: 50,
        width: 120,
        height: 80,
        fill: "#ef4444",
      },
    })
    const root = document.createElement("div")
    const dispose = panel("history").mount(root, context)

    const entries = root.querySelectorAll<HTMLElement>("[data-testid='history-entry']")
    expect(entries).toHaveLength(2)
    expect(entries[0]?.textContent).toContain("2")
    expect(entries[1]?.textContent).toContain("1")

    entries[1]!.click()

    expect(context.editor.getRecord("node-1")).toBeDefined()
    expect(context.editor.getRecord("node-2")).toBeUndefined()
    expect(root.querySelectorAll("[data-testid='history-entry']")).toHaveLength(2)
    expect(
      root.querySelector("[data-testid='history-entry'][data-current='true']")?.textContent,
    ).toContain("1")
    expect(
      root.querySelector("[data-testid='history-entry'][data-current='false']")?.textContent,
    ).toContain("2")

    if (typeof dispose === "function") dispose()
  })

  it("renders resources or an honest empty state", async () => {
    const resources = { list: vi.fn().mockResolvedValue([{ id: "asset-1", name: "Logo" }]) }
    const context = createContext(resources)
    const root = document.createElement("div")
    const dispose = panel("resources").mount(root, context)

    await vi.waitFor(() => expect(root.textContent).toContain("Logo"))
    expect(root.querySelector("[data-testid='empty-resources']")).toBeNull()
    if (typeof dispose === "function") dispose()

    const emptyRoot = document.createElement("div")
    panel("resources").mount(emptyRoot, createContext())
    expect(emptyRoot.querySelector("[data-testid='empty-resources']")).not.toBeNull()
  })

  it("renders a resource error and emits panel-failure when listing throws synchronously", () => {
    const error = new Error("resource service unavailable")
    const context = createContext({
      list: () => {
        throw error
      },
    })
    const root = document.createElement("div")

    expect(() => panel("resources").mount(root, context)).not.toThrow()
    expect(root.querySelector("[data-testid='resource-error']")?.textContent).toBe("无法加载资源。")
    expect(root.querySelector("[data-testid='empty-resources']")).toBeNull()
    expect(context.emit).toHaveBeenCalledWith({
      type: "panel-failure",
      panelId: "resources",
      error,
    })
  })

  it("renders a resource error and emits panel-failure when listing rejects", async () => {
    const error = new Error("resource request failed")
    const context = createContext({ list: () => Promise.reject(error) })
    const root = document.createElement("div")

    panel("resources").mount(root, context)
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid='resource-error']")?.textContent).toBe(
        "无法加载资源。",
      )
    })
    expect(context.emit).toHaveBeenCalledWith({
      type: "panel-failure",
      panelId: "resources",
      error,
    })
  })

  it("provides named empty states for remaining utility panels", () => {
    const context = createContext()
    for (const id of ["signals"] satisfies PanelId[]) {
      const root = document.createElement("div")
      panel(id).mount(root, context)
      expect(root.querySelector(`[data-testid='empty-${id}']`)).not.toBeNull()
    }

    const outputRoot = document.createElement("div")
    panel("output").mount(outputRoot, context)
    expect(outputRoot.querySelector(".composeui-editor__output > h2")).toBeNull()
    expect(outputRoot.querySelector("[role='log']")).not.toBeNull()
    expect(outputRoot.querySelector("[data-testid='empty-output']")?.textContent).toBe("暂无输出。")
  })

  it("renders operation rows and structured details", async () => {
    const events = [
      operationEvent(),
      operationEvent({
        eventId: "event-2",
        sequence: 2,
        category: "diagnostic",
        type: "diagnostic.reported",
        status: "failed",
        diagnostics: [{ code: "NODE_LOCKED", message: "节点已锁定", severity: "error" }],
        payload: { reason: "locked" },
      }),
    ] satisfies OperationEvent[]
    const operationLog = fakeOperationLogController(events)
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))

    await vi.waitFor(() => {
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(2)
    })
    expect(root.querySelector("[role='log']")).not.toBeNull()
    expect(root.querySelector("input[aria-label='搜索操作日志']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-entry']")?.getAttribute("data-level")).toBe(
      "succeeded",
    )
    expect(root.querySelector("[data-testid='output-entry']")?.getAttribute("data-category")).toBe(
      "document",
    )

    root.querySelectorAll<HTMLElement>("[data-testid='output-entry']")[1]!.click()
    expect(root.querySelector("[data-testid='output-details']")?.textContent).toContain(
      "NODE_LOCKED",
    )
    expect(
      root.querySelectorAll("[data-testid='output-entry']")[1]?.getAttribute("aria-selected"),
    ).toBe("true")

    expect(root.querySelector("[data-testid='output-filter-trigger']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-more-trigger']")).not.toBeNull()
    root.querySelector<HTMLElement>("[data-testid='output-list']")!.click()
    expect(root.querySelector("[data-testid='output-details']")).toBeNull()
    expect(root.querySelector("[data-testid='output-replay']")).toBeNull()

    if (typeof dispose === "function") dispose()
  })

  it("updates details immediately from controller notifications", async () => {
    let notify: ((state: OperationLogControllerState) => void) | undefined
    const first = operationEvent()
    const second = operationEvent({
      eventId: "event-2",
      sequence: 2,
      category: "diagnostic",
      type: "diagnostic.reported",
      status: "failed",
      diagnostics: [{ code: "NODE_LOCKED", message: "节点已锁定", severity: "error" }],
    })
    const operationLog: OperationLogControllerPort = {
      query: vi.fn(async () => [first]),
      subscribe: vi.fn((listener) => {
        notify = listener
        return () => undefined
      }),
      exportSession: vi.fn(async () => "bundle"),
      importBundle: vi.fn(async () => undefined),
      startReplay: vi.fn(),
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    notify?.({
      rows: [second],
      query: { levels: [], categories: [], search: "" },
      filter: {},
      detail: second,
      selection: second,
    })
    expect(root.querySelector("[data-testid='output-details']")?.textContent).toContain(
      "NODE_LOCKED",
    )
    await Promise.resolve()
    expect(root.querySelector("[data-testid='output-details']")?.textContent).toContain(
      "NODE_LOCKED",
    )
    if (typeof dispose === "function") dispose()
  })

  it("ignores stale queries and async work after dispose", async () => {
    const pending: Array<{ resolve: (events: readonly OperationEvent[]) => void }> = []
    const eventOne = operationEvent()
    const eventTwo = operationEvent({ eventId: "event-2", sequence: 2 })
    const operationLog: OperationLogControllerPort = {
      query: vi.fn(
        () =>
          new Promise<readonly OperationEvent[]>((resolve) => {
            pending.push({ resolve })
          }),
      ),
      subscribe: vi.fn(() => () => undefined),
      exportSession: vi.fn(async () => "bundle"),
      importBundle: vi.fn(async () => undefined),
      startReplay: vi.fn(),
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    const search = root.querySelector<HTMLInputElement>("input[aria-label='搜索操作日志']")!
    search.value = "new"
    search.dispatchEvent(new Event("input", { bubbles: true }))
    pending[1]!.resolve([eventTwo])
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-entry']")?.textContent).toContain("2"),
    )
    dispose()
    dispose()
    pending[0]!.resolve([eventOne])
    await Promise.resolve()
    expect(root.childElementCount).toBe(0)
  })

  it("shows a query retry action after a rejected query", async () => {
    const event = operationEvent()
    const query = vi
      .fn<OperationLogControllerPort["query"]>()
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce([event])
    const operationLog: OperationLogControllerPort = {
      ...fakeOperationLogController([]),
      query,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))

    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "查询操作日志失败",
      ),
    )
    root.querySelector<HTMLButtonElement>("[data-testid='output-query-retry']")!.click()
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    expect(query).toHaveBeenCalledTimes(2)

    if (typeof dispose === "function") dispose()
  })

  it("resets an active search from the filtered empty state", async () => {
    const event = operationEvent()
    const query = vi.fn(async ({ search }: { search: string }) =>
      search === "missing" ? [] : [event],
    )
    const operationLog: OperationLogControllerPort = {
      ...fakeOperationLogController([]),
      query,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    const search = root.querySelector<HTMLInputElement>("input[aria-label='搜索操作日志']")!
    search.value = "missing"
    search.dispatchEvent(new Event("input", { bubbles: true }))
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-empty-filtered']")?.textContent).toContain(
        "没有符合条件的日志",
      ),
    )
    root.querySelector<HTMLButtonElement>("[data-testid='output-reset-empty-filter']")!.click()
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    expect(search.value).toBe("")
    expect(query).toHaveBeenLastCalledWith({ levels: [], categories: [], search: "" })

    if (typeof dispose === "function") dispose()
  })



  it("starts replay from the selected operation", async () => {
    const operationLog = fakeOperationLogController([operationEvent()])
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    await vi.waitFor(() => expect(operationLog.startReplay).toHaveBeenCalledWith(1))

    if (typeof dispose === "function") dispose()
  })


  it("returns all first-party panel descriptors with stable ids", () => {
    const ids: PanelId[] = createWorkspacePanels().map((descriptor) => descriptor.id)
    expect(ids).toEqual([
      "scene",
      "resources",
      "history",
      "canvas",
      "inspector",
      "signals",
      "output",
    ])
  })
})
