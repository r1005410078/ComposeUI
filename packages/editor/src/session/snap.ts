/**
 * @module snap
 *
 * 工作区网格吸附纯函数：标量、点、矩形按步长取整。
 *
 * 边界：不读写 Session/Store；非法 step 抛 `INVALID_GRID_SIZE`。
 * 数据流：Session setGridSize / 指针 commit → snap* → 写入 document 的坐标。
 */

export function assertValidGridSize(step: number): void {
  if (!Number.isFinite(step) || step <= 0 || step < 1 || step > 1024) {
    throw new Error("INVALID_GRID_SIZE")
  }
}

export function snapScalar(value: number, step: number): number {
  assertValidGridSize(step)
  if (!Number.isFinite(value)) throw new Error("INVALID_COORDINATE")
  // Math.round 在 (-0.5, 0) 会得到 -0；归一化为 +0 以匹配 Object.is / toBe
  const snapped = Math.round(value / step) * step
  return snapped === 0 ? 0 : snapped
}

export function snapPoint(point: { x: number; y: number }, step: number): { x: number; y: number } {
  return { x: snapScalar(point.x, step), y: snapScalar(point.y, step) }
}

export function snapRect(
  rect: { x: number; y: number; width: number; height: number },
  step: number,
  edges: { left?: boolean; top?: boolean; right?: boolean; bottom?: boolean } = {
    left: true,
    top: true,
    right: true,
    bottom: true,
  },
): { x: number; y: number; width: number; height: number } {
  assertValidGridSize(step)
  let { x, y, width, height } = rect
  let right = x + width
  let bottom = y + height
  if (edges.left) x = snapScalar(x, step)
  if (edges.top) y = snapScalar(y, step)
  if (edges.right) right = snapScalar(right, step)
  if (edges.bottom) bottom = snapScalar(bottom, step)
  width = Math.max(1, right - x)
  height = Math.max(1, bottom - y)
  // 仅吸附尺寸边时，用吸附后的 right/bottom 反推原点，保持该边锚定
  if (edges.right && !edges.left) x = right - width
  if (edges.bottom && !edges.top) y = bottom - height
  return { x, y, width, height }
}
