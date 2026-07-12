import type { Viewport } from "./session"

export interface Point {
  x: number
  y: number
}

function assertValidZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("INVALID_ZOOM")
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  assertValidZoom(viewport.zoom)
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  assertValidZoom(viewport.zoom)
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
}

export function worldToParentLocal(point: Point, parentWorldOrigin: Point): Point {
  return {
    x: point.x - parentWorldOrigin.x,
    y: point.y - parentWorldOrigin.y,
  }
}

export function zoomAt(viewport: Viewport, screenPoint: Point, nextZoom: number): Viewport {
  assertValidZoom(nextZoom)
  const world = screenToWorld(screenPoint, viewport)
  return {
    x: screenPoint.x - world.x * nextZoom,
    y: screenPoint.y - world.y * nextZoom,
    zoom: nextZoom,
  }
}
