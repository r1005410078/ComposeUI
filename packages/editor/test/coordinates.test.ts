import { describe, expect, it } from "vitest"
import { screenToWorld, worldToParentLocal, worldToScreen, zoomAt } from "@composeui/editor"

describe("Workspace coordinates", () => {
  it("round-trips world and screen coordinates", () => {
    const viewport = { x: 120, y: -40, zoom: 1.5 }

    expect(screenToWorld(worldToScreen({ x: 30, y: 60 }, viewport), viewport)).toEqual({
      x: 30,
      y: 60,
    })
  })

  it("keeps the world point beneath the pointer stable while zooming", () => {
    const before = { x: 0, y: 0, zoom: 1 }
    const pointer = { x: 200, y: 100 }
    const after = zoomAt(before, pointer, 2)

    expect(screenToWorld(pointer, before)).toEqual(screenToWorld(pointer, after))
  })

  it("derives parent-local coordinates without using workspace zoom", () => {
    expect(worldToParentLocal({ x: 160, y: 90 }, { x: 100, y: 50 })).toEqual({
      x: 60,
      y: 40,
    })
  })

  it("rejects invalid current and next zoom values", () => {
    expect(() => worldToScreen({ x: 0, y: 0 }, { x: 0, y: 0, zoom: 0 })).toThrow("INVALID_ZOOM")
    expect(() =>
      screenToWorld({ x: 0, y: 0 }, { x: 0, y: 0, zoom: Number.POSITIVE_INFINITY }),
    ).toThrow("INVALID_ZOOM")
    expect(() => zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, -1)).toThrow("INVALID_ZOOM")
  })

  it("rejects non-finite viewport and point coordinates", () => {
    expect(() => worldToScreen({ x: Number.NaN, y: 0 }, { x: 0, y: 0, zoom: 1 })).toThrow(
      "INVALID_COORDINATE",
    )
    expect(() =>
      screenToWorld({ x: 0, y: Number.POSITIVE_INFINITY }, { x: 0, y: 0, zoom: 1 }),
    ).toThrow("INVALID_COORDINATE")
    expect(() =>
      worldToScreen({ x: 0, y: 0 }, { x: Number.NEGATIVE_INFINITY, y: 0, zoom: 1 }),
    ).toThrow("INVALID_COORDINATE")
    expect(() => worldToParentLocal({ x: 0, y: 0 }, { x: 0, y: Number.NaN })).toThrow(
      "INVALID_COORDINATE",
    )
    expect(() => zoomAt({ x: 0, y: 0, zoom: 1 }, { x: Number.POSITIVE_INFINITY, y: 0 }, 2)).toThrow(
      "INVALID_COORDINATE",
    )
  })

  it("rejects non-finite calculated coordinates", () => {
    expect(() => worldToScreen({ x: Number.MAX_VALUE, y: 0 }, { x: 0, y: 0, zoom: 2 })).toThrow(
      RangeError,
    )
    expect(() =>
      screenToWorld({ x: Number.MAX_VALUE, y: 0 }, { x: -Number.MAX_VALUE, y: 0, zoom: 1 }),
    ).toThrow(RangeError)
    expect(() => zoomAt({ x: 0, y: 0, zoom: 1 }, { x: Number.MAX_VALUE, y: 0 }, 2)).toThrow(
      RangeError,
    )
  })
})
