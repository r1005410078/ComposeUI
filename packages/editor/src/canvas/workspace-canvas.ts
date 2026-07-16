/**
 * @module workspace-canvas
 *
 * 工作区 Canvas2D 底景：无限 world 网格 + 顶/左标尺与游标读数。
 *
 * 边界：仅绘制；不写 Document / Session。节点仍由 DOM 渲染。
 * 数据流：session viewport + grid* + cursorWorld → setSize / redraw。
 *
 * 性能：只遍历视口外扩 AABB 内的格线。
 * 密度：Godot 式 — 从 gridSize 起对 world 步长反复 ×2，直到屏幕间距达标；
 * 标尺数字与刻度各自有最小 CSS 像素间距，极小 zoom 时也不会挤成一团。
 */

import { screenToWorld, worldToScreen } from "../session/coordinates"
import type { Viewport } from "../session/session"

/** 主网格间距 = 当前次线步长 × GRID_MAJOR_EVERY。 */
export const GRID_MAJOR_EVERY = 4

/**
 * 次网格线在屏幕上的最小间距（CSS 像素）。
 * 低于此值时对 world 步长 ×2 升档，而不是硬画过密线。
 */
export const MIN_MINOR_SCREEN_PX = 4

/**
 * 标尺短刻度的最小屏幕间距（CSS 像素）。
 * 与 Godot 类似：zoom 变小时刻度 world 步长升档，而不是堆叠。
 */
export const MIN_RULER_TICK_SCREEN_PX = 6

/**
 * 标尺数字标签的最小屏幕间距（CSS 像素）。
 * 保证如 -16384 一类长数字在极小 zoom 下仍可读（Godot 0.4% 时约 50–70px 一档）。
 */
export const MIN_RULER_LABEL_SCREEN_PX = 50

/** 顶/左标尺厚度（CSS 像素）。 */
export const RULER_SIZE = 20

/** 防止极端 zoom 下 ×2 死循环的上限次数。 */
const ADAPTIVE_STEP_MAX_DOUBLES = 48

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

/**
 * Godot 式自适应 world 步长：从 `baseStep` 起反复 ×2，直到 `step * zoom ≥ minScreenPx`。
 * 只升档、不降到 base 以下；无效输入原样返回 baseStep（由调用方决定是否跳过绘制）。
 */
export function adaptiveWorldStep(baseStep: number, zoom: number, minScreenPx: number): number {
  if (!Number.isFinite(baseStep) || baseStep <= 0) return baseStep
  if (!Number.isFinite(zoom) || zoom <= 0) return baseStep
  if (!Number.isFinite(minScreenPx) || minScreenPx <= 0) return baseStep

  let step = baseStep
  for (let i = 0; i < ADAPTIVE_STEP_MAX_DOUBLES; i++) {
    if (step * zoom >= minScreenPx) return step
    step *= 2
  }
  return step
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

/** 主线：相对当前次线步长，索引为 GRID_MAJOR_EVERY 的倍数（含负索引）。 */
function isMajorGridLine(world: number, minorStep: number): boolean {
  const index = Math.round(world / minorStep)
  return ((index % GRID_MAJOR_EVERY) + GRID_MAJOR_EVERY) % GRID_MAJOR_EVERY === 0
}

/** 标签落点：world 是否对齐 labelStep（含负索引与浮点容差）。 */
function isLabelStep(world: number, labelStep: number): boolean {
  if (!Number.isFinite(labelStep) || labelStep <= 0) return false
  const index = Math.round(world / labelStep)
  return Math.abs(world - index * labelStep) <= labelStep * 1e-9
}

interface CanvasThemeColors {
  minor: string
  major: string
  rulerBg: string
  rulerText: string
  rulerTick: string
  cursor: string
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
  /** getComputedStyle 昂贵；主题 token 稳定，缓存到 resize/重建。 */
  let theme: CanvasThemeColors | null = null
  let ctx: CanvasRenderingContext2D | null = null

  const readTheme = (): CanvasThemeColors => {
    const styles = getComputedStyle(element)
    return {
      minor: cssVar(styles, "--composeui-canvas-grid-minor", FALLBACK_MINOR),
      major: cssVar(styles, "--composeui-canvas-grid-major", FALLBACK_MAJOR),
      rulerBg: cssVar(styles, "--composeui-surface-panel", FALLBACK_RULER_BG),
      rulerText: cssVar(styles, "--composeui-text-muted", FALLBACK_RULER_TEXT),
      rulerTick: cssVar(styles, "--composeui-border-default", FALLBACK_RULER_TICK),
      cursor: cssVar(styles, "--composeui-canvas-selection", FALLBACK_CURSOR),
    }
  }

  const setSize = (nextWidth: number, nextHeight: number, nextDpr: number): void => {
    if (destroyed) return
    const safeDpr = Number.isFinite(nextDpr) && nextDpr > 0 ? nextDpr : 1
    const w = Math.max(0, nextWidth)
    const h = Math.max(0, nextHeight)
    const sizeChanged = cssWidth !== w || cssHeight !== h || dpr !== safeDpr
    cssWidth = w
    cssHeight = h
    dpr = safeDpr
    const bw = Math.max(0, Math.floor(w * safeDpr))
    const bh = Math.max(0, Math.floor(h * safeDpr))
    // 改 canvas 位图尺寸会清空内容并失掉 context 状态；仅在真正变化时写
    if (element.width !== bw) element.width = bw
    if (element.height !== bh) element.height = bh
    if (sizeChanged) {
      element.style.width = `${w}px`
      element.style.height = `${h}px`
      // 尺寸变化后重新取 context（部分浏览器在 resize 后仍有效，但统一重置更稳）
      ctx = null
    }
  }

  const redraw = (input: WorkspaceCanvasRedrawInput): void => {
    if (destroyed) return
    if (cssWidth <= 0 || cssHeight <= 0) return
    if (ctx === null) ctx = element.getContext("2d")
    if (ctx === null) return

    const { viewport, gridVisible, gridSize, cursorWorld, showRulers } = input
    if (!Number.isFinite(gridSize) || gridSize <= 0) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (theme === null) theme = readTheme()
    const { minor: minorColor, major: majorColor, rulerBg, rulerText, rulerTick, cursor: cursorColor } =
      theme

    // Godot 式：网格/标尺 world 步长随 zoom ×2 升档，保证屏幕间距
    const minorStep = adaptiveWorldStep(gridSize, viewport.zoom, MIN_MINOR_SCREEN_PX)
    const majorStep = minorStep * GRID_MAJOR_EVERY
    const rulerTickStep = adaptiveWorldStep(gridSize, viewport.zoom, MIN_RULER_TICK_SCREEN_PX)
    const rulerLabelStep = adaptiveWorldStep(gridSize, viewport.zoom, MIN_RULER_LABEL_SCREEN_PX)

    // 视口对应 world AABB，再外扩一格避免边缘缺线
    const topLeft = screenToWorld({ x: 0, y: 0 }, viewport)
    const bottomRight = screenToWorld({ x: cssWidth, y: cssHeight }, viewport)
    const expand = Math.max(minorStep, rulerTickStep)
    const worldMinX = Math.min(topLeft.x, bottomRight.x) - expand
    const worldMaxX = Math.max(topLeft.x, bottomRight.x) + expand
    const worldMinY = Math.min(topLeft.y, bottomRight.y) - expand
    const worldMaxY = Math.max(topLeft.y, bottomRight.y) + expand

    // 屏幕空间：world * zoom + pan（避免每条线构造 Point + 调 worldToScreen）
    const { x: panX, y: panY, zoom } = viewport
    const toScreenX = (worldX: number): number => worldX * zoom + panX
    const toScreenY = (worldY: number): number => worldY * zoom + panY

    if (gridVisible) {
      const drawAxisLines = (axis: "x" | "y", step: number, isMajorPass: boolean): void => {
        const lines =
          axis === "x"
            ? visibleGridLines(worldMinX, worldMaxX, step)
            : visibleGridLines(worldMinY, worldMaxY, step)
        ctx!.beginPath()
        for (const world of lines) {
          // 主线 pass 只画主；次线 pass 跳过主（避免双描）
          const isMajor = isMajorGridLine(world, minorStep)
          if (isMajorPass !== isMajor) continue
          if (axis === "x") {
            const sx = toScreenX(world)
            if (sx < -1 || sx > cssWidth + 1) continue
            ctx!.moveTo(sx + 0.5, 0)
            ctx!.lineTo(sx + 0.5, cssHeight)
          } else {
            const sy = toScreenY(world)
            if (sy < -1 || sy > cssHeight + 1) continue
            ctx!.moveTo(0, sy + 0.5)
            ctx!.lineTo(cssWidth, sy + 0.5)
          }
        }
        ctx!.strokeStyle = isMajorPass ? majorColor : minorColor
        ctx!.lineWidth = 1
        ctx!.stroke()
      }

      // 次线与主线均用升档后的步长；zoom 足够大时 minorStep === gridSize，行为与原先一致
      drawAxisLines("x", minorStep, false)
      drawAxisLines("y", minorStep, false)
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

      // 顶标尺：短刻度批量 stroke 一次；数字仅 labelStep
      ctx.textAlign = "center"
      let lastLabelRight = -Infinity
      ctx.beginPath()
      for (const world of visibleGridLines(worldMinX, worldMaxX, rulerTickStep)) {
        const sx = toScreenX(world)
        if (sx < RULER_SIZE - 1 || sx > cssWidth + 1) continue
        const showLabel = isLabelStep(world, rulerLabelStep)
        const tickH = showLabel ? 8 : 4
        ctx.moveTo(sx + 0.5, RULER_SIZE - tickH)
        ctx.lineTo(sx + 0.5, RULER_SIZE)
        if (showLabel) {
          const text = formatWorldLabel(world)
          const halfW = ctx.measureText(text).width / 2
          // 与上一标签重叠则跳过（极端长数字的安全网）
          if (sx - halfW >= lastLabelRight + 4) {
            ctx.fillText(text, sx, RULER_SIZE / 2 - 1)
            lastLabelRight = sx + halfW
          }
        }
      }
      ctx.strokeStyle = rulerTick
      ctx.stroke()

      // 左标尺：刻度批量 stroke；标签仍逐个 rotate（次数已由 labelStep 限制）
      let lastLabelEdge = -Infinity
      ctx.beginPath()
      for (const world of visibleGridLines(worldMinY, worldMaxY, rulerTickStep)) {
        const sy = toScreenY(world)
        if (sy < RULER_SIZE - 1 || sy > cssHeight + 1) continue
        const showLabel = isLabelStep(world, rulerLabelStep)
        const tickW = showLabel ? 8 : 4
        ctx.moveTo(RULER_SIZE - tickW, sy + 0.5)
        ctx.lineTo(RULER_SIZE, sy + 0.5)
        if (showLabel) {
          const text = formatWorldLabel(world)
          const halfW = ctx.measureText(text).width / 2
          if (sy - halfW >= lastLabelEdge + 4) {
            ctx.save()
            ctx.translate(RULER_SIZE / 2 - 1, sy)
            ctx.rotate(-Math.PI / 2)
            ctx.textAlign = "center"
            ctx.fillStyle = rulerText
            ctx.fillText(text, 0, 0)
            ctx.restore()
            lastLabelEdge = sy + halfW
          }
        }
      }
      ctx.strokeStyle = rulerTick
      ctx.stroke()

      // 角块盖住交叉
      ctx.fillStyle = rulerBg
      ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE)
      ctx.strokeStyle = rulerTick
      ctx.strokeRect(0.5, 0.5, RULER_SIZE - 1, RULER_SIZE - 1)

      if (cursorWorld !== null) {
        const screenX = toScreenX(cursorWorld.x)
        const screenY = toScreenY(cursorWorld.y)
        ctx.strokeStyle = cursorColor
        ctx.fillStyle = cursorColor
        ctx.lineWidth = 1

        // 顶标尺游标
        if (screenX >= RULER_SIZE && screenX <= cssWidth) {
          ctx.beginPath()
          ctx.moveTo(screenX + 0.5, 0)
          ctx.lineTo(screenX + 0.5, RULER_SIZE)
          ctx.stroke()
        }
        // 左标尺游标
        if (screenY >= RULER_SIZE && screenY <= cssHeight) {
          ctx.beginPath()
          ctx.moveTo(0, screenY + 0.5)
          ctx.lineTo(RULER_SIZE, screenY + 0.5)
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
        const boxX = Math.min(
          Math.max(RULER_SIZE + 4, screenX + 8),
          Math.max(RULER_SIZE + 4, cssWidth - boxW - 2),
        )
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
    ctx = null
    theme = null
    element.remove()
  }

  return { element, setSize, redraw, destroy }
}
