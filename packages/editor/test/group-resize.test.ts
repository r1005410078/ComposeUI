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
    expect(result.items.every((item) => item.width >= 1 && item.height >= 1)).toBe(true)
  })

  it("clamps each scaled item to the core minimum size", () => {
    const smallItems = [
      { id: "small", x: 0, y: 0, width: 10, height: 10 },
      { id: "large", x: 100, y: 100, width: 100, height: 100 },
    ]
    const result = resizeGroup(smallItems, { left: 0, top: 0, right: 200, bottom: 200 }, "nw", {
      x: 199,
      y: 199,
    })

    expect(result.items).toEqual([
      { id: "small", x: 199, y: 199, width: 1, height: 1 },
      { id: "large", x: 199.5, y: 199.5, width: 1, height: 1 },
    ])
  })
})
