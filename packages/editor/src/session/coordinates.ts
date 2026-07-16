/**
 * @module coordinates
 *
 * 坐标系纯函数：screen ↔ world ↔ parent-local，以及指针中心缩放。
 *
 * 约定：
 * - world：workspace 无限画布坐标
 * - screen：DOM 指针/视口像素
 * - parent-local：写入 FreeLayout 的坐标（相对父节点 world 原点）
 *
 * 不读写 Session/Store；非法输入抛稳定错误码。
 */

import type { Viewport } from "./session"

export interface Point {
  x: number
  y: number
}

function assertFiniteNumber(value: number, code: "INVALID_COORDINATE" | "INVALID_ZOOM"): void {
  if (!Number.isFinite(value)) throw new Error(code)
}

function assertValidZoom(zoom: number): void {
  assertFiniteNumber(zoom, "INVALID_ZOOM")
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("INVALID_ZOOM")
}

function assertValidPoint(point: Point): void {
  assertFiniteNumber(point.x, "INVALID_COORDINATE")
  assertFiniteNumber(point.y, "INVALID_COORDINATE")
}

function assertValidViewport(viewport: Viewport): void {
  assertFiniteNumber(viewport.x, "INVALID_COORDINATE")
  assertFiniteNumber(viewport.y, "INVALID_COORDINATE")
  assertValidZoom(viewport.zoom)
}

function assertFiniteResult(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("COORDINATE_RESULT_OUT_OF_RANGE")
  }
}

/** world → screen：先缩放再加 viewport 平移。 */
export function worldToScreen(point: Point, viewport: Viewport): Point {
  assertValidPoint(point)
  assertValidViewport(viewport)
  const result = {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
  assertFiniteResult(result)
  return result
}

/** screen → world：平移逆运算后再除以 zoom。 */
export function screenToWorld(point: Point, viewport: Viewport): Point {
  assertValidPoint(point)
  assertValidViewport(viewport)
  const result = {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
  assertFiniteResult(result)
  return result
}

/**
 * world 点转为相对父级 world 原点的局部坐标。
 * Free Layout 子节点 layout.x/y 使用此空间。
 */
export function worldToParentLocal(point: Point, parentWorldOrigin: Point): Point {
  assertValidPoint(point)
  assertValidPoint(parentWorldOrigin)
  const result = {
    x: point.x - parentWorldOrigin.x,
    y: point.y - parentWorldOrigin.y,
  }
  assertFiniteResult(result)
  return result
}

/**
 * 以 screenPoint 为锚点缩放到 nextZoom，使该点下的 world 坐标不变。
 * 实现指针中心滚轮缩放。
 */
export function zoomAt(viewport: Viewport, screenPoint: Point, nextZoom: number): Viewport {
  assertValidViewport(viewport)
  assertValidPoint(screenPoint)
  assertValidZoom(nextZoom)
  const world = screenToWorld(screenPoint, viewport)
  const result = {
    x: screenPoint.x - world.x * nextZoom,
    y: screenPoint.y - world.y * nextZoom,
    zoom: nextZoom,
  }
  assertFiniteResult(result)
  return result
}
