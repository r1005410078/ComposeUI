import type { OperationCategory, OperationEvent, OperationStatus } from "@composeui/operation-log"

export type OperationLogLevel = OperationStatus

export interface OperationLogViewQuery {
  levels: readonly OperationLogLevel[]
  categories: readonly OperationCategory[]
  search: string
}

export type OperationLogFilterValue<T extends string> = T | readonly T[]

export interface OperationLogFilter {
  category?: OperationLogFilterValue<OperationCategory>
  status?: OperationLogFilterValue<OperationStatus>
  text?: string
}

export interface OperationLogControllerState {
  readonly rows: readonly OperationEvent[]
  readonly query: OperationLogViewQuery
  readonly filter: OperationLogFilter
  readonly selection?: OperationEvent
  readonly detail?: OperationEvent
}

export type OperationLogControllerListener = (state: OperationLogControllerState) => void

export interface OperationLogControllerPort {
  query(query: OperationLogViewQuery): Promise<readonly OperationEvent[]>
  subscribe(listener: OperationLogControllerListener): () => void
  exportSession(): Promise<string>
  importBundle(serialized: string): Promise<void>
  startReplay(sequence: number): void | Promise<void>
}
