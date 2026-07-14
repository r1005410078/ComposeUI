export type OperationSessionStatus = "active" | "ended" | "abnormal"

export interface OperationSession {
  sessionId: string
  projectId: string
  status: OperationSessionStatus
  startedAt: string
  endedAt?: string
  eventCount: number
  finalHash?: string
}
