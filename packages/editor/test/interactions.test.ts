import { describe, expect, it } from "vitest"
import { createPointerMoveSession } from "../src/canvas/interactions"

describe("pointer move session", () => {
  it("keeps preview state ephemeral and emits one parent-local delta on commit", () => {
    const session = createPointerMoveSession({ x: 100, y: 50 }, { x: 10, y: 20 }, 2)
    session.update({ x: 140, y: 90 })

    expect(session.preview()).toEqual({ x: 30, y: 40 })
    expect(session.commit()).toEqual({ x: 20, y: 20 })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects unsafe zoom %s", (zoom) => {
    expect(() => createPointerMoveSession({ x: 0, y: 0 }, { x: 0, y: 0 }, zoom)).toThrow(
      "INVALID_ZOOM",
    )
  })

  it("rejects unsafe pointer input without corrupting the current preview", () => {
    const session = createPointerMoveSession({ x: 10, y: 20 }, { x: 30, y: 40 }, 1)

    expect(() => session.update({ x: Number.POSITIVE_INFINITY, y: 20 })).toThrow(
      "INVALID_COORDINATE",
    )
    const overflow = createPointerMoveSession({ x: 0, y: 0 }, { x: 30, y: 40 }, Number.MIN_VALUE)
    expect(() => overflow.update({ x: 1, y: 1 })).toThrow("COORDINATE_RESULT_OUT_OF_RANGE")
    expect(session.preview()).toEqual({ x: 30, y: 40 })
    expect(session.commit()).toEqual({ x: 0, y: 0 })
  })
})
