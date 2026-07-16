/**
 * @module query/types
 *
 * Query 层类型占位：布局投影契约（无默认实现）。
 *
 * 边界：
 * - 仅类型；不提供 free-layout 默认 `LayoutProjection` 实现（M2 再落地算法）。
 * - 解析结果为只读几何，不写 Store、不进 PageDocument。
 *
 * 数据流：RecordStore → CreateLayoutProjection → resolveNodeBox → 画布/overlay。
 */

import type { RecordStore } from "../store/store"

/** 节点在其布局坐标系下的轴对齐包围盒。 */
export interface ResolvedBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 布局投影：从权威 Store 解析节点几何。
 * M1.5 仅钉契约；实现由宿主/后续里程碑注入。
 */
export interface LayoutProjection {
  resolveNodeBox(nodeId: string): ResolvedBox | undefined
}

/** 由 Store 构造布局投影的工厂类型。 */
export type CreateLayoutProjection = (store: RecordStore) => LayoutProjection
