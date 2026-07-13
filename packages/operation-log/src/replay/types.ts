import type { Editor } from "@composeui/core"
import type { OperationEvent } from "../events"

export type ReplayDifference =
  | { type: "command-mismatch"; sequence: number; expected: unknown; actual: unknown }
  | {
      type: "patch-mismatch"
      sequence: number
      path: string
      expected: unknown
      actual: unknown
    }
  | { type: "state-hash-mismatch"; sequence: number; expected: string; actual: string }
  | { type: "missing-handler"; sequence: number; eventType: string }
  | { type: "schema-incompatible"; sequence: number; version: number }
  | { type: "environment-mismatch"; sequence: number; requirement: string }

export interface ReplaySessionPort {
  setSelection(ids: readonly string[]): void
  setViewport(viewport: { x: number; y: number; zoom: number }): void
  setInteractionMode(mode: "select" | "pan"): void
  setGridVisible(visible: boolean): void
  setExpanded(ids: readonly string[]): void
  getState(): unknown
}

export interface ReplayHandlerContext {
  editor: Editor
  session: ReplaySessionPort
  sideEffects: "disabled"
}

export type ReplayHandler = (
  event: OperationEvent,
  context: ReplayHandlerContext,
) => Promise<ReplayDifference | undefined>

export type ReplayHandlerResolution =
  | { ok: true; handler: ReplayHandler }
  | { ok: false; difference: ReplayDifference }
