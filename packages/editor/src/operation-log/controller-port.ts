/**
 * @module operation-log-controller-port
 *
 * Output 面板与 workspace 使用的操作日志控制器端口（接口层）。
 * 实现见 `operation-log-controller.ts`；便于测试替身与回放注入。
 */

import type { OperationCategory, OperationEvent, OperationStatus } from "@composeui/operation-log"
import type { ReplayControllerPort } from "./workspace/replay-controller"

export type OperationLogLevel = OperationStatus

/** Output 列表查询：级别、类别、全文搜索。 */
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

/**
 * 面板所需的最小能力：查询、订阅、导入导出、启动回放。
 * 可选挂 `replayController` 供工具条联动。
 */
export interface OperationLogControllerPort {
  query(query: OperationLogViewQuery): Promise<readonly OperationEvent[]>
  subscribe(listener: OperationLogControllerListener): () => void
  exportSession(): Promise<string>
  importBundle(serialized: string): Promise<void>
  startReplay(sequence: number): void | Promise<void>
  replayController?: ReplayControllerPort
}
