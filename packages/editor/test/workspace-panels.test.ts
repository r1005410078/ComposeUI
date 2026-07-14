// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import { EditorSession } from "../src/index"
import type { WorkspaceContext } from "../src/workspace/types"
import { createWorkspacePanels, type PanelId } from "../src/workspace/panels"
import type { OperationLogControllerPort } from "../src/operation-log-controller-port"
import type { OperationLogControllerState } from "../src/operation-log-controller-port"
import type { OperationEvent } from "@composeui/operation-log"
import { ReplayController } from "../src/workspace/replay-controller"
import type {
  ReplayControllerPort,
  ReplayControllerState,
} from "../src/workspace/replay-controller"

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

  it("keeps notified rows and detail when an earlier query resolves later", async () => {
    let notify: ((state: OperationLogControllerState) => void) | undefined
    let resolveQuery: ((rows: readonly OperationEvent[]) => void) | undefined
    const stale = operationEvent()
    const notified = operationEvent({
      eventId: "event-2",
      sequence: 2,
      category: "diagnostic",
      type: "diagnostic.reported",
      status: "failed",
    })
    const operationLog: OperationLogControllerPort = {
      ...fakeOperationLogController([]),
      query: vi.fn(
        () =>
          new Promise<readonly OperationEvent[]>((resolve) => {
            resolveQuery = resolve
          }),
      ),
      subscribe: vi.fn((listener) => {
        notify = listener
        return () => undefined
      }),
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))

    notify?.({
      rows: [notified],
      query: { levels: [], categories: [], search: "" },
      filter: {},
      detail: notified,
      selection: notified,
    })
    resolveQuery?.([stale])
    await Promise.resolve()

    expect(operationLog.query).toHaveBeenCalledTimes(1)
    expect(root.querySelector("[data-testid='output-entry']")?.textContent).toContain("2")
    expect(root.querySelector("[data-testid='output-details']")?.textContent).toContain(
      "diagnostic.reported",
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

  it("queries with exact filter selections from the output popover", async () => {
    const event = operationEvent({ status: "failed", category: "diagnostic" })
    const operationLog = fakeOperationLogController([event])
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!.click()
    root.querySelector<HTMLInputElement>("[data-filter-level='observed']")!.click()
    await vi.waitFor(() =>
      expect(operationLog.query).toHaveBeenLastCalledWith({
        levels: ["started", "succeeded", "failed"],
        categories: [],
        search: "",
      }),
    )
    root.querySelector<HTMLInputElement>("[data-filter-category='document']")!.click()
    await vi.waitFor(() =>
      expect(operationLog.query).toHaveBeenLastCalledWith({
        levels: ["started", "succeeded", "failed"],
        categories: ["history", "session", "workspace", "diagnostic", "system"],
        search: "",
      }),
    )

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

  it("handles import, export, and replay actions", async () => {
    const operationLog = fakeOperationLogController([operationEvent()])
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    const createObjectURL = vi.fn(() => "blob:operation-log")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    const schedule = vi.spyOn(globalThis, "setTimeout")
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-export']")!.click()
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
    expect(anchorClick).toHaveBeenCalled()
    expect(operationLog.exportSession).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0)
    const revokeTask = schedule.mock.calls.at(-1)?.[0]
    expect(typeof revokeTask).toBe("function")
    ;(revokeTask as () => void)()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:operation-log")

    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    await vi.waitFor(() => expect(operationLog.startReplay).toHaveBeenCalledWith(1))
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")?.disabled).toBe(
        false,
      ),
    )

    const input = root.querySelector<HTMLInputElement>("[data-testid='output-import-input']")!
    const file = { text: vi.fn(async () => "bundle") }
    Object.defineProperty(input, "files", { configurable: true, value: [file] })
    root.querySelector<HTMLButtonElement>("[data-testid='output-import']")!.click()
    input.dispatchEvent(new Event("change"))
    await vi.waitFor(() => expect(operationLog.importBundle).toHaveBeenCalledWith("bundle"))

    anchorClick.mockRestore()
    schedule.mockRestore()
    if (originalCreateObjectURL === undefined) {
      delete (URL as URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL
    } else {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      })
    }
    if (originalRevokeObjectURL === undefined) {
      delete (URL as URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL
    } else {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      })
    }
    if (typeof dispose === "function") dispose()
  })

  it("uses a data URL fallback for More export without ObjectURL APIs", async () => {
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: undefined })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: undefined })
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const operationLog = fakeOperationLogController([operationEvent()])
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-export']")!.click()
    await vi.waitFor(() => expect(anchorClick).toHaveBeenCalled())

    anchorClick.mockRestore()
    if (originalCreateObjectURL === undefined) {
      delete (URL as URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL
    } else {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      })
    }
    if (originalRevokeObjectURL === undefined) {
      delete (URL as URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL
    } else {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      })
    }
    if (typeof dispose === "function") dispose()
  })

  it("confirms clearing only the current view and preserves source events", async () => {
    const events = [operationEvent()]
    const operationLog = fakeOperationLogController(events)
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-clear']")!.click()

    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1)
    expect(root.querySelector("[data-testid='output-clear-confirmation']")?.textContent).toContain(
      "仅清空当前视图，持久化日志仍会保留。",
    )
    root.querySelector<HTMLButtonElement>("[data-testid='output-clear-confirm']")!.click()

    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(0)
    expect(root.querySelector("[data-testid='empty-output']")?.textContent).toBe("暂无输出。")
    await expect(operationLog.query({ levels: [], categories: [], search: "" })).resolves.toEqual(
      events,
    )
    if (typeof dispose === "function") dispose()
  })

  it("cancels clear confirmation when canceled or More closes", async () => {
    const root = document.createElement("div")
    const dispose = panel("output").mount(
      root,
      createContext(undefined, fakeOperationLogController([operationEvent()])),
    )
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    const more = root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!

    more.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-clear']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-clear-cancel']")!.click()
    expect(
      root.querySelector<HTMLElement>("[data-testid='output-clear-confirmation']")?.hidden,
    ).toBe(true)
    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1)

    root.querySelector<HTMLButtonElement>("[data-testid='output-clear']")!.click()
    more.click()
    expect(root.querySelector("[data-testid='output-more-menu']")).toBeNull()
    more.click()
    expect(root.querySelector<HTMLButtonElement>("[data-testid='output-clear']")?.hidden).toBe(
      false,
    )
    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1)
    if (typeof dispose === "function") dispose()
  })

  it("blocks duplicate export, import, and replay while each action is busy", async () => {
    let resolveExport: ((value: string) => void) | undefined
    let resolveImport: (() => void) | undefined
    let resolveReplay: (() => void) | undefined
    const base = fakeOperationLogController([operationEvent()])
    const operationLog: OperationLogControllerPort = {
      ...base,
      exportSession: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveExport = resolve
          }),
      ),
      importBundle: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveImport = resolve
          }),
      ),
      startReplay: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveReplay = resolve
          }),
      ),
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    const more = root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!
    const input = root.querySelector<HTMLInputElement>("[data-testid='output-import-input']")!
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ text: vi.fn(async () => "bundle") }],
    })

    more.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-export']")!.click()
    await vi.waitFor(() => expect(operationLog.exportSession).toHaveBeenCalledOnce())
    expect(root.querySelector<HTMLButtonElement>("[data-testid='output-export']")?.disabled).toBe(
      true,
    )
    expect(root.querySelector<HTMLButtonElement>("[data-testid='output-import']")?.disabled).toBe(
      true,
    )
    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    expect(operationLog.startReplay).not.toHaveBeenCalled()
    input.dispatchEvent(new Event("change"))
    expect(operationLog.importBundle).not.toHaveBeenCalled()
    root.querySelector<HTMLButtonElement>("[data-testid='output-export']")!.click()
    expect(operationLog.exportSession).toHaveBeenCalledOnce()
    resolveExport?.("bundle")
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>("[data-testid='output-export']")?.disabled).toBe(
        false,
      ),
    )

    root.querySelector<HTMLButtonElement>("[data-testid='output-import']")!.click()
    input.dispatchEvent(new Event("change"))
    await vi.waitFor(() => expect(operationLog.importBundle).toHaveBeenCalledOnce())
    expect(root.querySelector("[data-testid='output-import']")?.textContent).toContain("正在导入…")
    input.dispatchEvent(new Event("change"))
    expect(operationLog.importBundle).toHaveBeenCalledOnce()
    resolveImport?.()
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>("[data-testid='output-import']")?.disabled).toBe(
        false,
      ),
    )

    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    await vi.waitFor(() => expect(operationLog.startReplay).toHaveBeenCalledOnce())
    expect(root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")?.disabled).toBe(
      true,
    )
    expect(root.querySelector("[data-testid='output-replay']")?.textContent).toContain("正在回放…")
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    expect(operationLog.startReplay).toHaveBeenCalledOnce()
    resolveReplay?.()
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")?.disabled).toBe(
        false,
      ),
    )
    if (typeof dispose === "function") dispose()
  })

  it("waits for a controller notification before showing successfully imported rows", async () => {
    const first = operationEvent()
    const second = operationEvent({ eventId: "event-2", sequence: 2 })
    let rows = [first]
    let notify: ((state: OperationLogControllerState) => void) | undefined
    const operationLog: OperationLogControllerPort = {
      query: vi.fn(async () => rows),
      subscribe: vi.fn((listener) => {
        notify = listener
        return () => undefined
      }),
      exportSession: vi.fn(async () => "bundle"),
      importBundle: vi.fn(async () => {
        rows = [first, second]
      }),
      startReplay: vi.fn(),
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    const search = root.querySelector<HTMLInputElement>("input[aria-label='搜索操作日志']")!
    search.value = "document"
    search.dispatchEvent(new Event("input"))
    const filter = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!
    filter.click()
    root.querySelector<HTMLInputElement>("[data-filter-category='system']")!.click()
    await vi.waitFor(() => expect(filter.textContent).toContain("筛选 5"))
    root.querySelector<HTMLButtonElement>("[data-testid='output-filter-close']")!.click()
    const input = root.querySelector<HTMLInputElement>("[data-testid='output-import-input']")!
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ text: vi.fn(async () => "bundle") }],
    })
    root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-import']")!.click()
    input.dispatchEvent(new Event("change"))
    await vi.waitFor(() => expect(operationLog.importBundle).toHaveBeenCalledWith("bundle"))

    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1)
    expect(root.querySelector("[data-testid='output-details']")).not.toBeNull()
    expect(search.value).toBe("document")
    expect(filter.textContent).toContain("筛选 5")

    notify?.({
      rows,
      query: {
        levels: [],
        categories: ["document", "history", "session", "workspace", "diagnostic"],
        search: "document",
      },
      filter: {},
      selection: first,
      detail: first,
    })
    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(2)
    expect(root.querySelector("[data-testid='output-details']")).not.toBeNull()
    if (typeof dispose === "function") dispose()
  })

  it("renders isolated replay state and a typed difference", async () => {
    const replayController = new ReplayController({
      createEngine: vi.fn(async () => ({
        runTo: vi.fn(async () => ({
          status: "paused" as const,
          deterministic: false,
          startedAtSequence: 0,
          currentSequence: 1,
          targetSequence: 1,
          difference: {
            type: "patch-mismatch" as const,
            sequence: 1,
            path: "forward.created[0].layout.width",
            expected: 120,
            actual: 999,
          },
        })),
        step: vi.fn(),
        verify: vi.fn(),
        continueBestEffort: vi.fn(),
        getState: vi.fn(() => ({ sequence: 1 })),
      })),
    })
    const base = fakeOperationLogController([operationEvent()])
    const operationLog: OperationLogControllerPort = { ...base, replayController }
    const context = createContext(undefined, operationLog)
    const originalStore = context.editor.getStore().all()
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, context)

    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()

    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='replay-difference']")?.textContent).toContain(
        "patch-mismatch",
      ),
    )
    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).toContain("当前 #1")
    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).toContain(
      "回放存在差异",
    )
    expect(context.editor.getStore().all()).toEqual(originalStore)
    expect(root.querySelector("[data-testid='replay-step-backward']")).not.toBeNull()
    if (typeof dispose === "function") dispose()
  })

  it("shows the original replay startup failure and keeps replay controls hidden", async () => {
    const replayController = new ReplayController({
      createEngine: vi.fn(async () => {
        throw new Error("LOG_BUNDLE_INTEGRITY_VIOLATION")
      }),
    })
    const base = fakeOperationLogController([operationEvent()])
    const operationLog: OperationLogControllerPort = {
      ...base,
      startReplay: (sequence) => replayController.start(sequence).then(() => undefined),
      replayController,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))

    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()

    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "LOG_BUNDLE_INTEGRITY_VIOLATION",
      ),
    )
    expect(root.querySelector("[data-testid='replay-host']")).toHaveProperty("hidden", true)
    expect(root.querySelector("[data-testid='replay-step-forward']")).toBeNull()
    if (typeof dispose === "function") dispose()
  })

  it("renders a selected replay action outside the details column", async () => {
    const startReplay = vi.fn(async () => undefined)
    const operationLog: OperationLogControllerPort = {
      ...fakeOperationLogController([operationEvent()]),
      startReplay,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))

    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    expect(root.querySelector("[data-testid='output-selection-action']")).toBeNull()

    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    expect(
      root
        .querySelector("[data-testid='output-auto-scroll']")
        ?.classList.contains("composeui-editor__output-auto-scroll-primary"),
    ).toBe(true)
    expect(
      root
        .querySelector("[data-testid='output-replay']")
        ?.classList.contains("composeui-editor__output-replay-primary"),
    ).toBe(true)
    const selectionAction = root.querySelector<HTMLElement>(
      "[data-testid='output-selection-action']",
    )
    expect(selectionAction?.textContent).toContain("回放到此处")
    expect(selectionAction?.parentElement?.getAttribute("data-testid")).toBe("output-body")
    selectionAction?.querySelector<HTMLButtonElement>("button")!.click()

    await vi.waitFor(() => expect(startReplay).toHaveBeenCalledWith(1))
    if (typeof dispose === "function") dispose()
  })

  it("catches synchronous replay button failures", async () => {
    const state: ReplayControllerState = {
      active: true,
      status: "paused",
      deterministic: true,
      currentSequence: 1,
    }
    const replayController: ReplayControllerPort = {
      start: vi.fn(async () => state),
      stepBackward: vi.fn(() => {
        throw new Error("step unavailable")
      }),
      stepForward: vi.fn(() => {
        throw new Error("step unavailable")
      }),
      runTo: vi.fn(async () => state),
      verify: vi.fn(async () => state),
      continueBestEffort: vi.fn(async () => state),
      stop: vi.fn(),
      getState: vi.fn(() => state),
      subscribe: vi.fn((callback) => {
        callback(state)
        return () => undefined
      }),
    }
    const operationLog: OperationLogControllerPort = {
      ...fakeOperationLogController([operationEvent()]),
      replayController,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLButtonElement>("[data-testid='replay-step-forward']")!.click()
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "下一步失败",
      ),
    )
    if (typeof dispose === "function") dispose()
  })

  it("keeps replay controls contextual and drives start, step, difference, and stop", async () => {
    let state: ReplayControllerState = { active: false, status: "idle", deterministic: true }
    let resolveExport: ((serialized: string) => void) | undefined
    const listeners = new Set<(next: ReplayControllerState) => void>()
    const publish = (next: ReplayControllerState): void => {
      state = next
      for (const listener of listeners) listener(next)
    }
    const replayController: ReplayControllerPort = {
      start: vi.fn(async (sequence: number) => {
        const next = {
          active: true,
          status: "paused" as const,
          deterministic: true,
          currentSequence: sequence,
          targetSequence: sequence,
        }
        publish(next)
        return next
      }),
      stepBackward: vi.fn(async () => state),
      stepForward: vi.fn(async () => state),
      runTo: vi.fn(async () => state),
      verify: vi.fn(async () => state),
      continueBestEffort: vi.fn(async () => state),
      stop: vi.fn(() => publish({ active: false, status: "idle", deterministic: true })),
      getState: vi.fn(() => state),
      subscribe: vi.fn((listener) => {
        listeners.add(listener)
        listener(state)
        return () => listeners.delete(listener)
      }),
    }
    const base = fakeOperationLogController([operationEvent()])
    const exportSession = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveExport = resolve
        }),
    )
    const operationLog: OperationLogControllerPort = {
      ...base,
      exportSession,
      replayController,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )

    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    expect(root.querySelector("[data-testid='replay-host']")).toHaveProperty("hidden", true)
    expect(
      root.querySelector("[data-testid='output-toolbar'] [data-testid='replay-step-forward']"),
    ).toBeNull()
    expect(
      root.querySelector("[data-testid='output-toolbar'] [data-testid='replay-verify']"),
    ).toBeNull()
    expect(
      root.querySelector("[data-testid='output-toolbar'] [data-testid='replay-stop']"),
    ).toBeNull()

    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    await vi.waitFor(() => expect(replayController.start).toHaveBeenCalledWith(1))
    expect(root.querySelector("[data-testid='replay-summary']")?.textContent).toContain("回放至 #1")

    root.querySelector<HTMLButtonElement>("[data-testid='replay-step-forward']")!.click()
    await vi.waitFor(() => expect(replayController.stepForward).toHaveBeenCalledOnce())

    root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-export']")!.click()
    await vi.waitFor(() => expect(exportSession).toHaveBeenCalledOnce())
    expect(
      root.querySelectorAll<HTMLButtonElement>(".composeui-editor__output-replay-controls button"),
    ).toSatisfy((buttons) => [...buttons].every((button) => button.disabled))
    resolveExport?.("bundle")
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>("[data-testid='replay-stop']")?.disabled).toBe(
        false,
      ),
    )

    publish({
      active: true,
      status: "paused",
      deterministic: false,
      currentSequence: 1,
      targetSequence: 1,
      difference: { type: "patch-mismatch", sequence: 1, path: "forward.updated[0]" },
    })
    expect(root.querySelector("[data-testid='replay-difference']")?.textContent).toContain(
      "patch-mismatch",
    )
    expect(root.querySelector("[aria-label='继续回放']")).not.toBeNull()

    root.querySelector<HTMLButtonElement>("[data-testid='replay-stop']")!.click()
    await vi.waitFor(() => expect(replayController.stop).toHaveBeenCalledOnce())
    expect(root.querySelector("[data-testid='replay-host']")).toHaveProperty("hidden", true)
    if (typeof dispose === "function") dispose()
  })

  it("retains output context and surfaces import, export, and replay failures", async () => {
    const importBundle = vi.fn<OperationLogControllerPort["importBundle"]>()
    const exportSession = vi.fn<OperationLogControllerPort["exportSession"]>()
    const startReplay = vi.fn<OperationLogControllerPort["startReplay"]>()
    importBundle.mockRejectedValue(new Error("bundle invalid"))
    exportSession.mockRejectedValue(new Error("export unavailable"))
    startReplay.mockRejectedValue(new Error("replay unavailable"))
    const base = fakeOperationLogController([operationEvent()])
    const operationLog: OperationLogControllerPort = {
      ...base,
      importBundle,
      exportSession,
      startReplay,
    }
    const root = document.createElement("div")
    const dispose = panel("output").mount(root, createContext(undefined, operationLog))
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1),
    )
    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    const search = root.querySelector<HTMLInputElement>("input[aria-label='搜索操作日志']")!
    search.value = "document"
    search.dispatchEvent(new Event("input"))
    const filter = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!
    filter.click()
    root.querySelector<HTMLInputElement>("[data-filter-category='system']")!.click()
    await vi.waitFor(() => expect(filter.textContent).toContain("筛选 5"))
    root.querySelector<HTMLButtonElement>("[data-testid='output-filter-close']")!.click()

    root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-export']")!.click()
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "导出日志失败",
      ),
    )
    expect(root.querySelector("[data-testid='output-more-menu']")).not.toBeNull()
    expect(search.value).toBe("document")
    expect(filter.textContent).toContain("筛选 5")
    expect(root.querySelector("[data-testid='output-details']")).not.toBeNull()

    const input = root.querySelector<HTMLInputElement>("[data-testid='output-import-input']")!
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          text: vi.fn(async () => {
            throw new Error("file unreadable")
          }),
        },
      ],
    })
    root.querySelector<HTMLButtonElement>("[data-testid='output-import']")!.click()
    input.dispatchEvent(new Event("change"))
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "file unreadable",
      ),
    )

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ text: vi.fn(async () => "bundle") }],
    })
    input.dispatchEvent(new Event("change"))
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "导入日志失败",
      ),
    )
    expect(root.querySelector("[data-testid='output-more-menu']")).not.toBeNull()
    expect(search.value).toBe("document")
    expect(filter.textContent).toContain("筛选 5")
    expect(root.querySelector("[data-testid='output-details']")).not.toBeNull()

    root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
    await vi.waitFor(() =>
      expect(root.querySelector("[data-testid='output-error']")?.textContent).toContain(
        "回放操作失败",
      ),
    )

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
