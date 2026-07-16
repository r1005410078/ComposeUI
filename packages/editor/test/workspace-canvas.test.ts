import { describe, expect, it } from "vitest"
import {
  adaptiveWorldStep,
  GRID_MAJOR_EVERY,
  MIN_MINOR_SCREEN_PX,
  MIN_RULER_LABEL_SCREEN_PX,
  MIN_RULER_TICK_SCREEN_PX,
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

describe("adaptiveWorldStep", () => {
  it("keeps base step when already sparse enough on screen", () => {
    // 8 world * zoom 1 = 8px ≥ 4
    expect(adaptiveWorldStep(8, 1, 4)).toBe(8)
  })

  it("doubles until screen spacing meets the threshold (Godot-style)", () => {
    // 8 * 0.004 = 0.032px → keep ×2 until ≥ 50px label gap
    // 16384 * 0.004 = 65.536 ≥ 50
    expect(adaptiveWorldStep(8, 0.004, 50)).toBe(16384)
  })

  it("matches Godot extreme zoom label spacing at 0.4%", () => {
    const zoom = 0.004
    const labelStep = adaptiveWorldStep(8, zoom, MIN_RULER_LABEL_SCREEN_PX)
    expect(labelStep * zoom).toBeGreaterThanOrEqual(MIN_RULER_LABEL_SCREEN_PX)
    // Tick step stays a power-of-two multiple of base and divides label step
    const tickStep = adaptiveWorldStep(8, zoom, MIN_RULER_TICK_SCREEN_PX)
    expect(labelStep % tickStep).toBe(0)
    expect(tickStep * zoom).toBeGreaterThanOrEqual(MIN_RULER_TICK_SCREEN_PX)
  })

  it("never shrinks below base step when zoomed in", () => {
    expect(adaptiveWorldStep(8, 20, MIN_RULER_LABEL_SCREEN_PX)).toBe(8)
  })

  it("returns empty-safe values for invalid inputs", () => {
    expect(adaptiveWorldStep(0, 1, 10)).toBe(0)
    expect(adaptiveWorldStep(-4, 1, 10)).toBe(-4)
    expect(adaptiveWorldStep(8, 0, 10)).toBe(8)
    expect(adaptiveWorldStep(8, Number.NaN, 10)).toBe(8)
  })
})

describe("grid density constants", () => {
  it("documents minor-line skip threshold and ruler readability targets", () => {
    expect(MIN_MINOR_SCREEN_PX).toBe(4)
    expect(GRID_MAJOR_EVERY).toBe(4)
    expect(MIN_RULER_TICK_SCREEN_PX).toBe(6)
    expect(MIN_RULER_LABEL_SCREEN_PX).toBe(50)
  })
})
