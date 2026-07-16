/**
 * @module pointer-marquee
 *
 * 框选手势：空白处拖拽矩形，更新 session.selection。
 */

import { worldToScreen } from "../session/coordinates"
import type { EditorSession } from "../session/session"
import type { EditorSessionState } from "../session/session"
import type { CanvasView } from "./board-render"
import { SVG_NAMESPACE } from "./overlay"
import {
  hasSelectionModifier,
  workspacePoint,
  type ActivePointerInteraction,
} from "./pointer-helpers"

export interface MarqueeSelectionOptions {
  session: EditorSession
  getSessionState: () => EditorSessionState
  isPreviewActive: () => boolean
  shell: HTMLElement
  workspace: HTMLElement
  overlay: SVGSVGElement
  canvas: CanvasView
  getActiveInteraction: () => ActivePointerInteraction | undefined
  setActiveInteraction: (interaction: ActivePointerInteraction | undefined) => void
}

export function beginMarqueeSelection(
  event: PointerEvent,
  options: MarqueeSelectionOptions,
): ActivePointerInteraction | undefined {
  if (options.isPreviewActive()) return undefined
  options.getActiveInteraction()?.cancel()
  event.preventDefault()
  options.shell.focus()
  const sessionState = options.getSessionState()
  const start = workspacePoint(event, options.workspace)
  const initialSelection = sessionState.selection
  const additive = hasSelectionModifier(event)
  const marquee = document.createElementNS(SVG_NAMESPACE, "rect")
  marquee.dataset.testid = "marquee-selection"
  marquee.dataset.marquee = "true"
  options.overlay.append(marquee)
  let current = start
  let ended = false
  const render = (): void => {
    marquee.setAttribute("x", String(Math.min(start.x, current.x)))
    marquee.setAttribute("y", String(Math.min(start.y, current.y)))
    marquee.setAttribute("width", String(Math.abs(current.x - start.x)))
    marquee.setAttribute("height", String(Math.abs(current.y - start.y)))
  }
  const cancel = (): void => {
    if (ended) return
    ended = true
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
    window.removeEventListener("pointercancel", onPointerCancel)
    marquee.remove()
    if (options.getActiveInteraction()?.cancel === cancel) options.setActiveInteraction(undefined)
  }
  function onPointerMove(nextEvent: PointerEvent): void {
    current = workspacePoint(nextEvent, options.workspace)
    render()
  }
  function onPointerUp(nextEvent: PointerEvent): void {
    onPointerMove(nextEvent)
    const left = Math.min(start.x, current.x)
    const top = Math.min(start.y, current.y)
    const right = Math.max(start.x, current.x)
    const bottom = Math.max(start.y, current.y)
    const matches: string[] = []
    const viewport = options.getSessionState().viewport
    for (const [id, visible] of options.canvas.visibleNodes) {
      const origin = worldToScreen({ x: visible.worldX, y: visible.worldY }, viewport)
      const end = worldToScreen(
        {
          x: visible.worldX + visible.node.layout.width,
          y: visible.worldY + visible.node.layout.height,
        },
        viewport,
      )
      if (origin.x <= right && end.x >= left && origin.y <= bottom && end.y >= top) {
        matches.push(id)
      }
    }
    cancel()
    options.session.setSelection(
      additive ? [...new Set([...initialSelection, ...matches])] : matches,
    )
  }
  function onPointerCancel(): void {
    cancel()
  }
  render()
  const interaction = { cancel }
  options.setActiveInteraction(interaction)
  window.addEventListener("pointermove", onPointerMove)
  window.addEventListener("pointerup", onPointerUp)
  window.addEventListener("pointercancel", onPointerCancel)
  return interaction
}
