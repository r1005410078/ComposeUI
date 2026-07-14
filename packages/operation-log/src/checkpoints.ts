import type { PageDocument } from "@composeui/core"

export interface OperationCheckpoint {
  sessionId: string
  sequence: number
  createdAt: string
  document: PageDocument
  sessionState: unknown
  documentHash: string
  sessionHash: string
}
