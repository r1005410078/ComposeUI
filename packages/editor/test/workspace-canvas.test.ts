import { describe, expect, it } from "vitest"
import {
  GRID_MAJOR_EVERY,
  MIN_MINOR_SCREEN_PX,
  visibleGridLines,
} from "../src/canvas/workspace-canvas"

describe("visibleGridLines", () => {
  it("lists grid lines covering the visible world span", () => {
    expect(visibleGridLines(-5, 20, 8)).toEqual([-8, 0, 8, 16, 24])
  })

  it("includes both endpoints when they already sit on the grid", () => {
    expect(visibleGridLines(0, 16, 8)).toEqual([0, 8, 16])
  })

  it("handles inverted min/max", () => {
    expect(visibleGridLines(20, -5, 8)).toEqual([-8, 0, 8, 16, 24])
  })

  it("returns empty for non-positive or non-finite step", () => {
    expect(visibleGridLines(0, 10, 0)).toEqual([])
    expect(visibleGridLines(0, 10, -4)).toEqual([])
    expect(visibleGridLines(0, 10, Number.NaN)).toEqual([])
  })

  it("aligns major stride with GRID_MAJOR_EVERY", () => {
    const minor = 8
    const major = minor * GRID_MAJOR_EVERY
    // -1..33 with step 32 → floor(-1/32)*32 = -32, ceil(33/32)*32 = 64
    expect(visibleGridLines(-1, major + 1, major)).toEqual([-major, 0, major, major * 2])
    expect(major).toBe(32)
  })
})

describe("grid density constants", () => {
  it("documents minor-line skip threshold", () => {
    expect(MIN_MINOR_SCREEN_PX).toBe(4)
    expect(GRID_MAJOR_EVERY).toBe(4)
  })
})
