/**
 * @module pointer-pan
 *
 * Workspace 平移手势：中键 / pan 模式 / 空格+拖拽。
 */

import type { EditorSession } from "../session/session"
import type { EditorSessionState } from "../session/session"
import type { ActivePointerInteraction } from "./pointer-helpers"

export interface WorkspacePanOptions {
  session: EditorSession
  getSessionState: () => EditorSessionState
  isPreviewActive: () => boolean
  shell: HTMLElement
  workspace: HTMLElement
  getActiveInteraction: () => ActivePointerInteraction | undefined
  setActiveInteraction: (interaction: ActivePointerInteraction | undefined) => void
}

export function beginWorkspacePan(
  event: PointerEvent,
  options: WorkspacePanOptions,
): ActivePointerInteraction | undefined {
  if (options.isPreviewActive()) return undefined
  options.getActiveInteraction()?.cancel()
  event.preventDefault()
  event.stopPropagation()
  options.workspace.dataset.panActive = "true"
  options.shell.dataset.panActive = "true"
  const start = { x: event.clientX, y: event.clientY }
  const viewport = options.getSessionState().viewport
  let ended = false
  const cancel = (): void => {
    if (ended) return
    ended = true
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
    window.removeEventListener("pointercancel", onPointerUp)
    delete options.workspace.dataset.panActive
    delete options.shell.dataset.panActive
    if (options.getActiveInteraction()?.cancel === cancel) options.setActiveInteraction(undefined)
  }
  function onPointerMove(nextEvent: PointerEvent): void {
    options.session.setViewport({
      x: viewport.x + nextEvent.clientX - start.x,
      y: viewport.y + nextEvent.clientY - start.y,
      zoom: viewport.zoom,
    })
  }
  function onPointerUp(nextEvent: PointerEvent): void {
    onPointerMove(nextEvent)
    cancel()
  }
  const interaction = { cancel }
  options.setActiveInteraction(interaction)
  window.addEventListener("pointermove", onPointerMove)
  window.addEventListener("pointerup", onPointerUp)
  window.addEventListener("pointercancel", onPointerUp)
  return interaction
}
