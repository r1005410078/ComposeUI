/**
 * @module workspace-canvas
 *
 * 工作区 Canvas2D 底景：无限 world 网格 + 顶/左标尺与游标读数。
 *
 * 边界：仅绘制；不写 Document / Session。节点仍由 DOM 渲染。
 * 数据流：session viewport + grid* + cursorWorld → setSize / redraw。
 *
 * 性能：只遍历视口外扩 AABB 内的格线；zoom*gridSize 过小时跳过次线。
 */

import { screenToWorld, worldToScreen } from "../session/coordinates"
import type { Viewport } from "../session/session"

/** 主网格间距 = gridSize × GRID_MAJOR_EVERY。 */
export const GRID_MAJOR_EVERY = 4

/**
 * 当 `zoom * gridSize`（CSS 像素）低于此阈值时跳过次网格，只画主线。
 * 避免极小缩放时线过密导致性能塌陷与视觉糊成一片。
 */
export const MIN_MINOR_SCREEN_PX = 4

/** 顶/左标尺厚度（CSS 像素）。 */
export const RULER_SIZE = 20

const FALLBACK_MINOR = "rgba(40, 94, 145, 0.24)"
const FALLBACK_MAJOR = "rgba(62, 128, 190, 0.28)"
const FALLBACK_RULER_BG = "rgba(6, 20, 38, 0.92)"
const FALLBACK_RULER_TEXT = "#718098"
const FALLBACK_RULER_TICK = "#17324f"
const FALLBACK_CURSOR = "#3a91ff"

export function visibleGridLines(worldMin: number, worldMax: number, step: number): number[] {
  if (
    !Number.isFinite(worldMin) ||
    !Number.isFinite(worldMax) ||
    !Number.isFinite(step) ||
    step <= 0
  ) {
    return []
  }
  const lo = Math.min(worldMin, worldMax)
  const hi = Math.max(worldMin, worldMax)
  // 用索引步进，避免 step 非整数时累计浮点误差
  const startIndex = Math.floor(lo / step)
  const endIndex = Math.ceil(hi / step)
  const lines: number[] = []
  for (let i = startIndex; i <= endIndex; i++) {
    lines.push(i * step)
  }
  return lines
}

export interface WorkspaceCanvasRedrawInput {
  viewport: Viewport
  gridVisible: boolean
  gridSize: number
  cursorWorld: { x: number; y: number } | null
  showRulers: boolean
}

export interface WorkspaceCanvas {
  element: HTMLCanvasElement
  setSize(cssWidth: number, cssHeight: number, dpr: number): void
  redraw(input: WorkspaceCanvasRedrawInput): void
  destroy(): void
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

function formatWorldLabel(value: number): string {
  if (!Number.isFinite(value)) return ""
  if (Math.abs(value) < 1e-9) return "0"
  if (Number.isInteger(value)) return String(value)
  const abs = Math.abs(value)
  if (abs >= 100) return String(Math.round(value))
  if (abs >= 10) return value.toFixed(1).replace(/\.0$/, "")
  return value.toFixed(2).replace(/\.?0+$/, "")
}

/** 主线：grid 索引为 GRID_MAJOR_EVERY 的倍数（含负索引）。 */
function isMajorGridLine(world: number, gridSize: number): boolean {
  const index = Math.round(world / gridSize)
  return ((index % GRID_MAJOR_EVERY) + GRID_MAJOR_EVERY) % GRID_MAJOR_EVERY === 0
}

export function createWorkspaceCanvas(): WorkspaceCanvas {
  const element = document.createElement("canvas")
  element.className = "composeui-editor__workspace-canvas"
  element.dataset.testid = "workspace-grid"
  element.setAttribute("aria-hidden", "true")

  let cssWidth = 0
  let cssHeight = 0
  let dpr = 1
  let destroyed = false

  const setSize = (nextWidth: number, nextHeight: number, nextDpr: number): void => {
    if (destroyed) return
    const safeDpr = Number.isFinite(nextDpr) && nextDpr > 0 ? nextDpr : 1
    const w = Math.max(0, nextWidth)
    const h = Math.max(0, nextHeight)
    cssWidth = w
    cssHeight = h
    dpr = safeDpr
    const bw = Math.max(0, Math.floor(w * safeDpr))
    const bh = Math.max(0, Math.floor(h * safeDpr))
    if (element.width !== bw) element.width = bw
    if (element.height !== bh) element.height = bh
    element.style.width = `${w}px`
    element.style.height = `${h}px`
  }

  const redraw = (input: WorkspaceCanvasRedrawInput): void => {
    if (destroyed) return
    if (cssWidth <= 0 || cssHeight <= 0) return
    const ctx = element.getContext("2d")
    if (ctx === null) return

    const { viewport, gridVisible, gridSize, cursorWorld, showRulers } = input
    if (!Number.isFinite(gridSize) || gridSize <= 0) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    const styles = getComputedStyle(element)
    const minorColor = cssVar(styles, "--composeui-canvas-grid-minor", FALLBACK_MINOR)
    const majorColor = cssVar(styles, "--composeui-canvas-grid-major", FALLBACK_MAJOR)
    const rulerBg = cssVar(styles, "--composeui-surface-panel", FALLBACK_RULER_BG)
    const rulerText = cssVar(styles, "--composeui-text-muted", FALLBACK_RULER_TEXT)
    const rulerTick = cssVar(styles, "--composeui-border-default", FALLBACK_RULER_TICK)
    const cursorColor = cssVar(styles, "--composeui-canvas-selection", FALLBACK_CURSOR)

    // 视口对应 world AABB，再外扩一格避免边缘缺线
    const topLeft = screenToWorld({ x: 0, y: 0 }, viewport)
    const bottomRight = screenToWorld({ x: cssWidth, y: cssHeight }, viewport)
    const expand = gridSize
    const worldMinX = Math.min(topLeft.x, bottomRight.x) - expand
    const worldMaxX = Math.max(topLeft.x, bottomRight.x) + expand
    const worldMinY = Math.min(topLeft.y, bottomRight.y) - expand
    const worldMaxY = Math.max(topLeft.y, bottomRight.y) + expand

    const minorScreen = viewport.zoom * gridSize
    const drawMinors = minorScreen >= MIN_MINOR_SCREEN_PX
    const majorStep = gridSize * GRID_MAJOR_EVERY

    if (gridVisible) {
      const drawAxisLines = (axis: "x" | "y", step: number, isMajorPass: boolean): void => {
        const lines =
          axis === "x"
            ? visibleGridLines(worldMinX, worldMaxX, step)
            : visibleGridLines(worldMinY, worldMaxY, step)
        ctx.beginPath()
        for (const world of lines) {
          // 主线 pass 只画主；次线 pass 跳过主（避免双描）
          const isMajor = isMajorGridLine(world, gridSize)
          if (isMajorPass !== isMajor) continue
          if (axis === "x") {
            const sx = worldToScreen({ x: world, y: 0 }, viewport).x
            if (sx < -1 || sx > cssWidth + 1) continue
            ctx.moveTo(sx + 0.5, 0)
            ctx.lineTo(sx + 0.5, cssHeight)
          } else {
            const sy = worldToScreen({ x: 0, y: world }, viewport).y
            if (sy < -1 || sy > cssHeight + 1) continue
            ctx.moveTo(0, sy + 0.5)
            ctx.lineTo(cssWidth, sy + 0.5)
          }
        }
        ctx.strokeStyle = isMajorPass ? majorColor : minorColor
        ctx.lineWidth = 1
        ctx.stroke()
      }

      if (drawMinors) {
        drawAxisLines("x", gridSize, false)
        drawAxisLines("y", gridSize, false)
      }
      drawAxisLines("x", majorStep, true)
      drawAxisLines("y", majorStep, true)
    }

    if (showRulers) {
      // 标尺底（盖住格线边缘）
      ctx.fillStyle = rulerBg
      ctx.fillRect(0, 0, cssWidth, RULER_SIZE)
      ctx.fillRect(0, 0, RULER_SIZE, cssHeight)

      ctx.strokeStyle = rulerTick
      ctx.fillStyle = rulerText
      ctx.lineWidth = 1
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif"
      ctx.textBaseline = "middle"

      // 过密时标尺也只画主刻度
      const tickStep = drawMinors ? gridSize : majorStep

      // 顶标尺（world X）
      ctx.textAlign = "center"
      for (const world of visibleGridLines(worldMinX, worldMaxX, tickStep)) {
        const sx = worldToScreen({ x: world, y: 0 }, viewport).x
        if (sx < RULER_SIZE - 1 || sx > cssWidth + 1) continue
        const isMajor = !drawMinors || isMajorGridLine(world, gridSize)
        const tickH = isMajor ? 8 : 4
        ctx.beginPath()
        ctx.moveTo(sx + 0.5, RULER_SIZE - tickH)
        ctx.lineTo(sx + 0.5, RULER_SIZE)
        ctx.stroke()
        if (isMajor) {
          ctx.fillText(formatWorldLabel(world), sx, RULER_SIZE / 2 - 1)
        }
      }

      // 左标尺（world Y）
      for (const world of visibleGridLines(worldMinY, worldMaxY, tickStep)) {
        const sy = worldToScreen({ x: 0, y: world }, viewport).y
        if (sy < RULER_SIZE - 1 || sy > cssHeight + 1) continue
        const isMajor = !drawMinors || isMajorGridLine(world, gridSize)
        const tickW = isMajor ? 8 : 4
        ctx.beginPath()
        ctx.moveTo(RULER_SIZE - tickW, sy + 0.5)
        ctx.lineTo(RULER_SIZE, sy + 0.5)
        ctx.stroke()
        if (isMajor) {
          ctx.save()
          ctx.translate(RULER_SIZE / 2 - 1, sy)
          ctx.rotate(-Math.PI / 2)
          ctx.textAlign = "center"
          ctx.fillText(formatWorldLabel(world), 0, 0)
          ctx.restore()
        }
      }

      // 角块盖住交叉
      ctx.fillStyle = rulerBg
      ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE)
      ctx.strokeStyle = rulerTick
      ctx.strokeRect(0.5, 0.5, RULER_SIZE - 1, RULER_SIZE - 1)

      if (cursorWorld !== null) {
        const screen = worldToScreen(cursorWorld, viewport)
        ctx.strokeStyle = cursorColor
        ctx.fillStyle = cursorColor
        ctx.lineWidth = 1

        // 顶标尺游标
        if (screen.x >= RULER_SIZE && screen.x <= cssWidth) {
          ctx.beginPath()
          ctx.moveTo(screen.x + 0.5, 0)
          ctx.lineTo(screen.x + 0.5, RULER_SIZE)
          ctx.stroke()
        }
        // 左标尺游标
        if (screen.y >= RULER_SIZE && screen.y <= cssHeight) {
          ctx.beginPath()
          ctx.moveTo(0, screen.y + 0.5)
          ctx.lineTo(RULER_SIZE, screen.y + 0.5)
          ctx.stroke()
        }

        const readout = `${formatWorldLabel(cursorWorld.x)}, ${formatWorldLabel(cursorWorld.y)}`
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif"
        ctx.textAlign = "left"
        ctx.textBaseline = "middle"
        const pad = 4
        const textW = ctx.measureText(readout).width
        const boxW = textW + pad * 2
        const boxH = 14
        const boxX = Math.min(Math.max(RULER_SIZE + 4, screen.x + 8), Math.max(RULER_SIZE + 4, cssWidth - boxW - 2))
        const boxY = 3
        ctx.fillStyle = rulerBg
        ctx.fillRect(boxX, boxY, boxW, boxH)
        ctx.strokeStyle = cursorColor
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1)
        ctx.fillStyle = cursorColor
        ctx.fillText(readout, boxX + pad, boxY + boxH / 2)
      }
    }
  }

  const destroy = (): void => {
    destroyed = true
    element.remove()
  }

  return { element, setSize, redraw, destroy }
}
