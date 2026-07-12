export type GroupResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"

export interface GroupResizeItem {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface GroupBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface GroupResizePointer {
  x: number
  y: number
}

export function selectionBounds(items: readonly GroupResizeItem[]): GroupBounds {
  if (items.length === 0) {
    throw new Error("Cannot calculate selection bounds without items")
  }

  const first = items[0]!

  return items.reduce<GroupBounds>(
    (bounds, item) => ({
      left: Math.min(bounds.left, item.x),
      top: Math.min(bounds.top, item.y),
      right: Math.max(bounds.right, item.x + item.width),
      bottom: Math.max(bounds.bottom, item.y + item.height),
    }),
    {
      left: first.x,
      top: first.y,
      right: first.x + first.width,
      bottom: first.y + first.height,
    },
  )
}

export function resizeGroup(
  items: readonly GroupResizeItem[],
  initial: GroupBounds,
  handle: GroupResizeHandle,
  pointer: GroupResizePointer,
): { bounds: GroupBounds; items: GroupResizeItem[] } {
  const bounds = { ...initial }

  if (handle.includes("w")) {
    bounds.left = Math.min(pointer.x, initial.right - 1)
  }
  if (handle.includes("e")) {
    bounds.right = Math.max(pointer.x, initial.left + 1)
  }
  if (handle.includes("n")) {
    bounds.top = Math.min(pointer.y, initial.bottom - 1)
  }
  if (handle.includes("s")) {
    bounds.bottom = Math.max(pointer.y, initial.top + 1)
  }

  const scaleX = (bounds.right - bounds.left) / (initial.right - initial.left)
  const scaleY = (bounds.bottom - bounds.top) / (initial.bottom - initial.top)

  return {
    bounds,
    items: items.map((item) => ({
      id: item.id,
      x: bounds.left + (item.x - initial.left) * scaleX,
      y: bounds.top + (item.y - initial.top) * scaleY,
      width: Math.max(1, item.width * scaleX),
      height: Math.max(1, item.height * scaleY),
    })),
  }
}
