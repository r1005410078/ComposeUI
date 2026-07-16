import { describe, expect, it } from "vitest"
import { snapRect, snapScalar } from "../src/session/snap"

describe("snapScalar", () => {
  it("rounds to nearest step", () => {
    expect(snapScalar(0, 8)).toBe(0)
    expect(snapScalar(3, 8)).toBe(0)
    expect(snapScalar(4, 8)).toBe(8)
    expect(snapScalar(12, 8)).toBe(16)
    expect(snapScalar(-3, 8)).toBe(0)
    expect(snapScalar(-5, 8)).toBe(-8)
  })

  it("rejects non-positive or non-finite step", () => {
    expect(() => snapScalar(1, 0)).toThrowError("INVALID_GRID_SIZE")
    expect(() => snapScalar(1, -2)).toThrowError("INVALID_GRID_SIZE")
    expect(() => snapScalar(1, Number.NaN)).toThrowError("INVALID_GRID_SIZE")
  })
})

describe("snapRect", () => {
  it("snaps origin and keeps min size 1", () => {
    const r = snapRect({ x: 3, y: 5, width: 10, height: 10 }, 8)
    expect(r.x % 8).toBe(0)
    expect(r.y % 8).toBe(0)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  it("snaps only requested edges on resize-like updates", () => {
    const r = snapRect({ x: 0, y: 0, width: 13, height: 20 }, 8, { right: true, bottom: true })
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.width).toBe(16)
    expect(r.height).toBe(24)
  })
})
