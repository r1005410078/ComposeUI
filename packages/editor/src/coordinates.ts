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
