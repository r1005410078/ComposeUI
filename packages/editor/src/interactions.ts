import type { Point } from "./coordinates"

export interface PointerMoveSession {
  update(screen: Point): void
  preview(): Point
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
