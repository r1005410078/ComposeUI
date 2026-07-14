import type { Diagnostic, EditorCommand, Result } from "@composeui/core"
import type { OperationEvent } from "../events"
import type { ReplayDifference, ReplayHandlerContext } from "./types"

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isEditorCommand(value: unknown): value is EditorCommand {
  return isRecord(value) && typeof value.id === "string" && isRecord(value.payload)
}

function payloadRecord(event: OperationEvent): UnknownRecord | undefined {
  return isRecord(event.payload) ? event.payload : undefined
}

function commandFrom(event: OperationEvent): EditorCommand | undefined {
  const payload = payloadRecord(event)
  return payload !== undefined && isEditorCommand(payload.command) ? payload.command : undefined
}

function diagnosticsOf(value: unknown): Diagnostic[] {
  if (!Array.isArray(value)) return []
  const diagnostics: Diagnostic[] = []
  for (const valueItem of value) {
    if (
      isRecord(valueItem) &&
      typeof valueItem.code === "string" &&
      (valueItem.severity === "error" || valueItem.severity === "warning") &&
      typeof valueItem.message === "string"
    ) {
      diagnostics.push(valueItem as unknown as Diagnostic)
    }
  }
  return diagnostics
}

function firstDifference(
  expected: unknown,
  actual: unknown,
  path: string,
): { path: string; expected: unknown; actual: unknown } | undefined {
  if (Object.is(expected, actual)) return undefined
  if (typeof expected !== typeof actual || expected === null || actual === null) {
    return { path, expected, actual }
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return { path, expected, actual }
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`)
      if (difference !== undefined) return difference
    }
    return undefined
  }
  if (typeof expected === "object") {
    if (!isRecord(expected) || !isRecord(actual)) return { path, expected, actual }
    const expectedKeys = Object.keys(expected)
    const actualKeys = Object.keys(actual)
    if (
      expectedKeys.length !== actualKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(actual, key))
    ) {
      const key =
        expectedKeys.find((candidate) => !Object.hasOwn(actual, candidate)) ??
        actualKeys.find((candidate) => !Object.hasOwn(expected, candidate))
      return { path: key === undefined ? path : `${path}.${key}`, expected, actual }
    }
    for (const key of expectedKeys) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`)
      if (difference !== undefined) return difference
    }
    return undefined
  }
  return { path, expected, actual }
}

function mismatch(
  event: OperationEvent,
  difference: { path: string; expected: unknown; actual: unknown },
): ReplayDifference {
  return { type: "patch-mismatch", sequence: event.sequence, ...difference }
}

function resultDiagnostics(result: Result<void>): string[] {
  return result.ok ? [] : sortCodes(result.diagnostics.map((diagnostic) => diagnostic.code))
}

function expectedDiagnostics(event: OperationEvent): string[] {
  return sortCodes(diagnosticsOf(event.diagnostics).map((diagnostic) => diagnostic.code))
}

function sortCodes(codes: readonly string[]): string[] {
  const sorted: string[] = []
  for (const code of codes) {
    const index = sorted.findIndex((existing) => existing > code)
    if (index === -1) sorted.push(code)
    else sorted.splice(index, 0, code)
  }
  return sorted
}

function stateSnapshot(context: ReplayHandlerContext): unknown {
  return { records: context.editor.getStore().all(), history: context.editor.getHistory() }
}

function isEmptyPatch(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.created) &&
    Array.isArray(value.updated) &&
    Array.isArray(value.removed) &&
    value.created.length === 0 &&
    value.updated.length === 0 &&
    value.removed.length === 0
  )
}

function commandMismatch(
  event: OperationEvent,
  expected: unknown,
  actual: unknown,
): ReplayDifference {
  return { type: "command-mismatch", sequence: event.sequence, expected, actual }
}

function validateStarted(event: OperationEvent): boolean {
  return commandFrom(event) !== undefined
}

export async function handleDocumentCommand(
  event: OperationEvent,
  context: ReplayHandlerContext,
): Promise<ReplayDifference | undefined> {
  if (context.sideEffects !== "disabled") {
    return {
      type: "environment-mismatch",
      sequence: event.sequence,
      requirement: "sideEffects=disabled",
    }
  }
  const command = commandFrom(event)
  if (command === undefined)
    return { type: "schema-incompatible", sequence: event.sequence, version: event.schemaVersion }
  if (event.status === "started")
    return validateStarted(event)
      ? undefined
      : { type: "schema-incompatible", sequence: event.sequence, version: event.schemaVersion }

  if (event.status === "failed") {
    const before = stateSnapshot(context)
    let result: Result<void>
    try {
      result = context.editor.dispatch(command)
    } catch (error) {
      return commandMismatch(
        event,
        "failed",
        error instanceof Error ? error.message : String(error),
      )
    }
    if (
      result.ok ||
      JSON.stringify(resultDiagnostics(result)) !== JSON.stringify(expectedDiagnostics(event))
    ) {
      return commandMismatch(
        event,
        { status: "failed", diagnostics: expectedDiagnostics(event) },
        {
          status: result.ok ? "succeeded" : "failed",
          diagnostics: resultDiagnostics(result),
        },
      )
    }
    const after = stateSnapshot(context)
    const stateDifference = firstDifference(before, after, "state")
    return stateDifference === undefined ? undefined : mismatch(event, stateDifference)
  }

  if (event.status !== "succeeded")
    return { type: "schema-incompatible", sequence: event.sequence, version: event.schemaVersion }
  const historyLength = context.editor.getHistory().entries.length
  const result = context.editor.dispatch(command)
  if (!result.ok)
    return commandMismatch(event, "succeeded", {
      status: "failed",
      diagnostics: result.diagnostics,
    })
  const payload = payloadRecord(event)
  const expectedPatch =
    payload?.patch ?? (isRecord(payload?.transaction) ? payload.transaction.forward : undefined)
  const actualTransaction = context.editor.getHistory().entries[historyLength]
  if (expectedPatch !== undefined && actualTransaction !== undefined) {
    const difference = firstDifference(expectedPatch, actualTransaction.forward, "forward")
    if (difference !== undefined) return mismatch(event, difference)
  }
  if (isRecord(payload?.transaction) && actualTransaction !== undefined) {
    const expectedInverse = payload.transaction.inverse
    if (expectedInverse !== undefined) {
      const difference = firstDifference(expectedInverse, actualTransaction.inverse, "inverse")
      if (difference !== undefined) return mismatch(event, difference)
    }
    for (const field of ["transactionId", "label"] as const) {
      if (
        payload.transaction[field] !== undefined &&
        payload.transaction[field] !== actualTransaction[field]
      ) {
        return commandMismatch(event, payload.transaction[field], actualTransaction[field])
      }
    }
  } else if (isRecord(payload?.transaction) && actualTransaction === undefined) {
    const expectedForward = payload.transaction.forward
    const expectedInverse = payload.transaction.inverse
    if (!isEmptyPatch(expectedForward) || !isEmptyPatch(expectedInverse)) {
      return commandMismatch(event, "transaction", undefined)
    }
  }
  return undefined
}

export async function handleHistoryOperation(
  event: OperationEvent,
  context: ReplayHandlerContext,
): Promise<ReplayDifference | undefined> {
  if (context.sideEffects !== "disabled") {
    return {
      type: "environment-mismatch",
      sequence: event.sequence,
      requirement: "sideEffects=disabled",
    }
  }
  const payload = payloadRecord(event)
  const expectedIndex = typeof payload?.currentIndex === "number" ? payload.currentIndex : undefined
  const historyBefore = context.editor.getHistory()
  if (event.type === "history.jump") {
    if (
      expectedIndex === undefined ||
      !Number.isInteger(expectedIndex) ||
      expectedIndex < 0 ||
      expectedIndex > historyBefore.entries.length
    ) {
      return { type: "schema-incompatible", sequence: event.sequence, version: event.schemaVersion }
    }
  }
  const before = stateSnapshot(context)
  let result: Result<void>
  try {
    if (event.type === "history.undo") result = context.editor.undo()
    else if (event.type === "history.redo") result = context.editor.redo()
    else result = context.editor.jumpToHistory(expectedIndex ?? 0)
  } catch (error) {
    return commandMismatch(
      event,
      event.status,
      error instanceof Error ? error.message : String(error),
    )
  }
  if (event.status === "failed") {
    if (
      result.ok ||
      JSON.stringify(resultDiagnostics(result)) !== JSON.stringify(expectedDiagnostics(event))
    ) {
      return commandMismatch(
        event,
        { status: "failed", diagnostics: expectedDiagnostics(event) },
        { status: result.ok ? "succeeded" : "failed", diagnostics: resultDiagnostics(result) },
      )
    }
    const difference = firstDifference(before, stateSnapshot(context), "state")
    return difference === undefined ? undefined : mismatch(event, difference)
  }
  if (!result.ok)
    return commandMismatch(event, "succeeded", {
      status: "failed",
      diagnostics: result.diagnostics,
    })
  if (expectedIndex !== undefined && context.editor.getHistory().currentIndex !== expectedIndex) {
    return commandMismatch(event, expectedIndex, context.editor.getHistory().currentIndex)
  }
  const actualHistory = context.editor.getHistory()
  const transactionIndex =
    event.type === "history.undo"
      ? historyBefore.currentIndex - 1
      : event.type === "history.redo"
        ? historyBefore.currentIndex
        : expectedIndex === undefined || expectedIndex === historyBefore.currentIndex
          ? undefined
          : expectedIndex < historyBefore.currentIndex
            ? expectedIndex
            : expectedIndex - 1
  const actualTransaction =
    transactionIndex === undefined ? undefined : actualHistory.entries[transactionIndex]
  if (
    event.transactionId !== undefined &&
    actualTransaction?.transactionId !== event.transactionId
  ) {
    return commandMismatch(event, event.transactionId, actualTransaction?.transactionId)
  }
  return undefined
}

export async function handleSessionOperation(
  event: OperationEvent,
  context: ReplayHandlerContext,
): Promise<ReplayDifference | undefined> {
  if (context.sideEffects !== "disabled") {
    return {
      type: "environment-mismatch",
      sequence: event.sequence,
      requirement: "sideEffects=disabled",
    }
  }
  const payload = payloadRecord(event)
  if (payload === undefined)
    return { type: "schema-incompatible", sequence: event.sequence, version: event.schemaVersion }
  switch (event.type) {
    case "session.selection": {
      const selection = Array.isArray(payload.selection) ? payload.selection : payload.ids
      if (!Array.isArray(selection) || !selection.every((id) => typeof id === "string"))
        return {
          type: "schema-incompatible",
          sequence: event.sequence,
          version: event.schemaVersion,
        }
      context.session.setSelection(selection)
      return undefined
    }
    case "session.viewport": {
      const viewport = isRecord(payload.viewport) ? payload.viewport : payload
      if (
        !isRecord(viewport) ||
        typeof viewport.x !== "number" ||
        typeof viewport.y !== "number" ||
        typeof viewport.zoom !== "number"
      )
        return {
          type: "schema-incompatible",
          sequence: event.sequence,
          version: event.schemaVersion,
        }
      context.session.setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
      return undefined
    }
    case "session.interactionMode":
    case "session.tool": {
      const mode = payload.interactionMode ?? payload.mode
      if (mode !== "select" && mode !== "pan")
        return {
          type: "schema-incompatible",
          sequence: event.sequence,
          version: event.schemaVersion,
        }
      context.session.setInteractionMode(mode)
      return undefined
    }
    case "session.gridVisibility":
    case "session.grid": {
      const visible = payload.gridVisible ?? payload.visible
      if (typeof visible !== "boolean")
        return {
          type: "schema-incompatible",
          sequence: event.sequence,
          version: event.schemaVersion,
        }
      context.session.setGridVisible(visible)
      return undefined
    }
    case "session.expandedTree":
    case "session.treeDisclosure": {
      const expanded = Array.isArray(payload.expanded) ? payload.expanded : payload.ids
      if (!Array.isArray(expanded) || !expanded.every((id) => typeof id === "string"))
        return {
          type: "schema-incompatible",
          sequence: event.sequence,
          version: event.schemaVersion,
        }
      context.session.setExpanded(expanded)
      return undefined
    }
    default:
      return { type: "missing-handler", sequence: event.sequence, eventType: event.type }
  }
}

export async function handleSystemOperation(
  event: OperationEvent,
  context: ReplayHandlerContext,
): Promise<ReplayDifference | undefined> {
  if (context.sideEffects !== "disabled") {
    return {
      type: "environment-mismatch",
      sequence: event.sequence,
      requirement: "sideEffects=disabled",
    }
  }
  return undefined
}

export const builtinReplayHandlers = {
  "document.command": handleDocumentCommand,
  "history.undo": handleHistoryOperation,
  "history.redo": handleHistoryOperation,
  "history.jump": handleHistoryOperation,
  "session.selection": handleSessionOperation,
  "session.viewport": handleSessionOperation,
  "session.expandedTree": handleSessionOperation,
  "session.gridVisibility": handleSessionOperation,
  "session.interactionMode": handleSessionOperation,
  "session.tool": handleSessionOperation,
  "session.grid": handleSessionOperation,
  "session.treeDisclosure": handleSessionOperation,
  "system.sessionStarted": handleSystemOperation,
  "system.checkpoint": handleSystemOperation,
  "system.sessionEnded": handleSystemOperation,
} as const
