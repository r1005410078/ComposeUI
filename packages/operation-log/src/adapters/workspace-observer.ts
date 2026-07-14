import type { OperationEvent } from "../events"
import type { RecordOperationInput } from "../recorder"

export interface WorkspaceOperationRecorder {
  recordDeferred(factory: () => Promise<RecordOperationInput>): Promise<OperationEvent>
}

export type WorkspaceOperationSourceEvent =
  | { type: "panel-opened" | "panel-closed" | "panel-activated"; panelId: string }
  | { type: "layout-changed" | "layout-loaded" | "layout-reset"; layout: unknown }
  | {
      type: "layout-failure"
      operation: "load" | "save" | "remove"
      error: { name: string; message: string; code?: string }
    }
  | {
      type: "panel-failure"
      panelId: string
      error: { name: string; message: string; code?: string }
    }

export interface WorkspaceOperationObserver {
  observe(event: WorkspaceOperationSourceEvent): void
}

const workspaceTypes = {
  "panel-opened": "workspace.panel.opened",
  "panel-closed": "workspace.panel.closed",
  "panel-activated": "workspace.panel.activated",
  "layout-changed": "workspace.layout.changed",
  "layout-loaded": "workspace.layout.loaded",
  "layout-reset": "workspace.layout.reset",
} as const

export function createWorkspaceOperationObserver(
  recorder: WorkspaceOperationRecorder,
): WorkspaceOperationObserver {
  return {
    observe(event) {
      let snapshot: WorkspaceOperationSourceEvent
      try {
        snapshot = structuredClone(event)
      } catch {
        recordSerializationFailure(recorder, sourceType(event))
        return
      }
      recordDeferred(recorder, async () => toRecordInput(snapshot))
    },
  }
}

function recordSerializationFailure(recorder: WorkspaceOperationRecorder, type: string): void {
  recordDeferred(recorder, async () =>
    diagnosticInput(
      "WORKSPACE_EVENT_SERIALIZATION_FAILURE",
      `Unable to serialize workspace event: ${type}`,
      { sourceType: type },
    ),
  )
}

function recordDeferred(
  recorder: WorkspaceOperationRecorder,
  factory: () => Promise<RecordOperationInput>,
): void {
  try {
    void recorder.recordDeferred(factory).catch(() => undefined)
  } catch {
    // Operation recording must never interrupt the editor workflow.
  }
}

function sourceType(event: WorkspaceOperationSourceEvent): string {
  try {
    return typeof event.type === "string" ? event.type : "unknown"
  } catch {
    return "unknown"
  }
}

function toRecordInput(event: WorkspaceOperationSourceEvent): RecordOperationInput {
  switch (event.type) {
    case "panel-opened":
    case "panel-closed":
    case "panel-activated":
      return {
        category: "workspace",
        type: workspaceTypes[event.type],
        status: "observed",
        payload: { panelId: event.panelId },
      }
    case "layout-changed":
    case "layout-loaded":
    case "layout-reset":
      return {
        category: "workspace",
        type: workspaceTypes[event.type],
        status: "observed",
        payload: { layout: event.layout },
      }
    case "layout-failure":
      return diagnosticInput("WORKSPACE_LAYOUT_FAILURE", event.error.message, {
        operation: event.operation,
        error: event.error,
      })
    case "panel-failure":
      return diagnosticInput("WORKSPACE_PANEL_FAILURE", event.error.message, {
        panelId: event.panelId,
        error: event.error,
      })
  }
}

function diagnosticInput(
  code:
    | "WORKSPACE_LAYOUT_FAILURE"
    | "WORKSPACE_PANEL_FAILURE"
    | "WORKSPACE_EVENT_SERIALIZATION_FAILURE",
  message: string,
  payload: unknown,
): RecordOperationInput {
  return {
    category: "diagnostic",
    type: "diagnostic.reported",
    status: "observed",
    diagnostics: [{ code, severity: "error", message }],
    payload,
  }
}
