/**
 * @module interactions
 *
 * 指针拖拽的会话草稿：屏幕位移换算为 parent-local delta。
 *
 * 边界：此处只做预览/commit 几何，不写 Store。
 * 完成时应 `commit()` 得到 delta 再 `editor.dispatch({ id: "node.move", ... })`。
 */

import type { Point } from "./coordinates"

export interface PointerMoveSession {
  update(screen: Point): void
  /** 当前预览下的 parent-local 位置（非 delta）。 */
  preview(): Point
  /** 相对 startLocal 的位移，供 node.move。 */
  commit(): Point
}

function assertValidPoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("INVALID_COORDINATE")
  }
}

function assertValidZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("INVALID_ZOOM")
}

function assertFiniteResult(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("COORDINATE_RESULT_OUT_OF_RANGE")
  }
}

/**
 * @param startScreen 拖拽起点屏幕坐标
 * @param startLocal 节点起始 parent-local
 * @param zoom 当前 viewport.zoom（屏幕像素 / world 单位）
 */
export function createPointerMoveSession(
  startScreen: Point,
  startLocal: Point,
  zoom: number,
): PointerMoveSession {
  assertValidPoint(startScreen)
  assertValidPoint(startLocal)
  assertValidZoom(zoom)

  let current = startScreen
  const localAt = (screen: Point): Point => {
    assertValidPoint(screen)
    const result = {
      x: startLocal.x + (screen.x - startScreen.x) / zoom,
      y: startLocal.y + (screen.y - startScreen.y) / zoom,
    }
    assertFiniteResult(result)
    return result
  }

  return {
    update(screen) {
      localAt(screen)
      current = screen
    },
    preview() {
      return localAt(current)
    },
    commit() {
      const next = localAt(current)
      const delta = { x: next.x - startLocal.x, y: next.y - startLocal.y }
      assertFiniteResult(delta)
      return delta
    },
  }
}
