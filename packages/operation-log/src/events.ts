export type OperationCategory =
  | "document"
  | "history"
  | "session"
  | "workspace"
  | "diagnostic"
  | "system"

export type OperationStatus = "observed" | "started" | "succeeded" | "failed"

export interface OperationDiagnostic {
  code: string
  severity: "error" | "warning"
  message: string
  recordId?: string
}

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
  payload?: T
  diagnostics?: readonly OperationDiagnostic[]
  beforeHash?: string
  afterHash?: string
}

export interface OperationLogQuery {
  sessionId: string
  afterSequence?: number
}
