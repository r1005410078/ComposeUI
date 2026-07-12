import { describe, expect, it } from "vitest"
import { resizeGroup, selectionBounds } from "../src/group-resize"

const items = [
  { id: "first", x: 10, y: 20, width: 100, height: 80 },
  { id: "second", x: 210, y: 60, width: 100, height: 80 },
]

const initial = {
  left: 10,
  top: 20,
  right: 310,
  bottom: 140,
}

describe("group resize geometry", () => {
  it("computes the outer bounds of the selected items", () => {
    expect(selectionBounds(items)).toEqual(initial)
  })

  it("scales every item from the original snapshot for a south-east resize", () => {
    const result = resizeGroup(items, initial, "se", { x: 610, y: 260 })

    expect(result.bounds).toEqual({ left: 10, top: 20, right: 610, bottom: 260 })
    expect(result.items).toEqual([
      { id: "first", x: 10, y: 20, width: 200, height: 160 },
      { id: "second", x: 410, y: 100, width: 200, height: 160 },
    ])
    expect(items).toEqual([
      { id: "first", x: 10, y: 20, width: 100, height: 80 },
      { id: "second", x: 210, y: 60, width: 100, height: 80 },
    ])
  })

  it("keeps the south-east corner fixed for a north-west resize", () => {
    const result = resizeGroup(items, initial, "nw", { x: 160, y: 80 })

    expect(result.bounds).toEqual({ left: 160, top: 80, right: 310, bottom: 140 })
    expect(result.items).toEqual([
      { id: "first", x: 160, y: 80, width: 50, height: 40 },
      { id: "second", x: 260, y: 100, width: 50, height: 40 },
    ])
  })

  it("resizes only the selected axis for an east edge", () => {
    const result = resizeGroup(items, initial, "e", { x: 460, y: 999 })

    expect(result.bounds).toEqual({ left: 10, top: 20, right: 460, bottom: 140 })
    expect(result.items).toEqual([
      { id: "first", x: 10, y: 20, width: 150, height: 80 },
      { id: "second", x: 310, y: 60, width: 150, height: 80 },
    ])
  })

  it("clamps a moved edge instead of flipping the group", () => {
    const result = resizeGroup(items, initial, "nw", { x: 999, y: -100 })

    expect(result.bounds).toEqual({ left: 309, top: -100, right: 310, bottom: 140 })
    expect(result.items).toEqual([
      { id: "first", x: 309, y: -100, width: 0.33333333333333337, height: 160 },
      { id: "second", x: 309.6666666666667, y: -20, width: 0.33333333333333337, height: 160 },
    ])
  })
})
