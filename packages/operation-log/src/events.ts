import type { Diagnostic } from "@composeui/core"

export type OperationCategory =
  | "document"
  | "history"
  | "session"
  | "workspace"
  | "diagnostic"
  | "system"

export type OperationStatus = "observed" | "started" | "succeeded" | "failed"

export interface OperationEvent<T = unknown> {
  schemaVersion: 1
  eventId: string
  sessionId: string
  projectId: string
  sequence: number
  timestamp: string
  category: OperationCategory
  type: string
  status: OperationStatus
  transactionId?: string
  causationId?: string
  payload: T
  diagnostics?: readonly Diagnostic[]
  beforeHash?: string
  afterHash?: string
}

export interface OperationLogQuery {
  sessionId: string
  afterSequence?: number
}
