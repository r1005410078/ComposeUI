import { describe, expect, it, vi } from "vitest"
import {
  createWorkspaceOperationObserver,
  type RecordOperationInput,
  type WorkspaceOperationRecorder,
  type WorkspaceOperationSourceEvent,
} from "@composeui/operation-log"

function recorder(): {
  recorder: WorkspaceOperationRecorder
  inputs: RecordOperationInput[]
} {
  const inputs: RecordOperationInput[] = []
  return {
    recorder: {
      async recordDeferred(factory) {
        const input = await factory()
        inputs.push(input)
        return {
          ...input,
          schemaVersion: 1,
          eventId: "event-1",
          sessionId: "session-1",
          projectId: "project-1",
          sequence: inputs.length,
          timestamp: "2026-07-14T00:00:00.000Z",
        }
      },
    },
    inputs,
  }
}

describe("workspace operation observer", () => {
  it.each([
    ["panel-opened", "workspace.panel.opened"],
    ["panel-closed", "workspace.panel.closed"],
    ["panel-activated", "workspace.panel.activated"],
  ] as const)("maps %s to %s", async (type, operationType) => {
    const { recorder: deferredRecorder, inputs } = recorder()
    const observer = createWorkspaceOperationObserver(deferredRecorder)

    observer.observe({ type, panelId: "inspector" })
    await Promise.resolve()

    expect(inputs).toEqual([
      {
        category: "workspace",
        type: operationType,
        status: "observed",
        payload: { panelId: "inspector" },
      },
    ])
  })

  it.each([
    ["layout-changed", "workspace.layout.changed"],
    ["layout-loaded", "workspace.layout.loaded"],
    ["layout-reset", "workspace.layout.reset"],
  ] as const)("maps %s to %s with an eagerly cloned layout", async (type, operationType) => {
    let releaseFactory: (() => void) | undefined
    const inputs: RecordOperationInput[] = []
    const deferredRecorder: WorkspaceOperationRecorder = {
      recordDeferred(factory) {
        return new Promise((resolve) => {
          releaseFactory = () => {
            void factory().then((input) => {
              inputs.push(input)
              resolve({
                ...input,
                schemaVersion: 1,
                eventId: "event-1",
                sessionId: "session-1",
                projectId: "project-1",
                sequence: 1,
                timestamp: "2026-07-14T00:00:00.000Z",
              })
            })
          }
        })
      },
    }
    const observer = createWorkspaceOperationObserver(deferredRecorder)
    const layout = { version: 1, modeId: "2d", layout: { panels: ["inspector"] } }

    observer.observe({ type, layout })
    layout.layout.panels.push("signals")
    releaseFactory?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(inputs).toEqual([
      {
        category: "workspace",
        type: operationType,
        status: "observed",
        payload: { layout: { version: 1, modeId: "2d", layout: { panels: ["inspector"] } } },
      },
    ])
  })

  const failures = [
    [
      {
        type: "layout-failure",
        operation: "save",
        error: { name: "Error", message: "Storage unavailable" },
      },
      "WORKSPACE_LAYOUT_FAILURE",
    ],
    [
      {
        type: "panel-failure",
        panelId: "inspector",
        error: { name: "Error", message: "Mount failed" },
      },
      "WORKSPACE_PANEL_FAILURE",
    ],
  ] as const satisfies readonly [
    WorkspaceOperationSourceEvent,
    "WORKSPACE_LAYOUT_FAILURE" | "WORKSPACE_PANEL_FAILURE",
  ][]

  it.each(failures)("maps %s to a diagnostic", async (source, code) => {
    const { recorder: deferredRecorder, inputs } = recorder()
    const observer = createWorkspaceOperationObserver(deferredRecorder)

    observer.observe(source)
    await Promise.resolve()

    expect(inputs).toEqual([
      expect.objectContaining({
        category: "diagnostic",
        type: "diagnostic.reported",
        status: "observed",
        diagnostics: [expect.objectContaining({ code, message: source.error.message })],
      }),
    ])
  })

  it("does not throw when deferred recording rejects", async () => {
    const deferredRecorder: WorkspaceOperationRecorder = {
      recordDeferred: vi.fn(() => Promise.reject(new Error("store unavailable"))),
    }
    const observer = createWorkspaceOperationObserver(deferredRecorder)

    expect(() => observer.observe({ type: "panel-opened", panelId: "inspector" })).not.toThrow()
    await Promise.resolve()
  })
})
