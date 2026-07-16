/**
 * @module pointer
 *
 * 画布指针状态机：move/resize/group-resize → session 或单次 dispatch。
 * pan/marquee 见 pointer-pan / pointer-marquee。
 *
 * 边界：
 * - 拖拽中只改 DOM 预览与 session；松手再 dispatch
 * - 通过注入 deps 访问 board/overlay，避免与 mount 循环依赖
 *
 * 数据流：pointerdown → session 预览 → pointerup → coreEditor.dispatch
 */

import type { Editor, NodeRecord, RecordStore } from "@composeui/core"
import { screenToWorld, zoomAt } from "../session/coordinates"
import type { EditorSession } from "../session/session"
import type { EditorSessionState } from "../session/session"
import { applyNodeStyle, isTransformLocked, type CanvasView } from "./board-render"
import { resizeGroup, selectionBounds } from "./group-resize"
import type { GroupResizeHandle } from "./group-resize"
import { createPointerMoveSession } from "./interactions"
import type { PointerMoveSession } from "./interactions"
import {
  GROUP_RESIZE_HANDLES,
  getGroupSelection,
  renderSelectionOverlay,
  setSelectionOutlinePreview,
} from "./overlay"
import {
  hasSelectionModifier,
  toggleSelection,
  workspacePoint,
  type ActivePointerInteraction,
} from "./pointer-helpers"
import { beginMarqueeSelection } from "./pointer-marquee"
import { beginWorkspacePan } from "./pointer-pan"

export interface PointerControllerDeps {
  coreEditor: Editor
  session: EditorSession
  getSessionState: () => EditorSessionState
  getCurrentStore: () => RecordStore
  isPreviewActive: () => boolean
  shell: HTMLElement
  workspace: HTMLElement
  board: HTMLElement
  overlay: SVGSVGElement
  canvas: CanvasView
}

export interface PointerController {
  isGroupResizeActive(): boolean
  cancelActive(): void
  attach(): void
  detach(): void
}

/** 绑定 board/overlay/workspace/shell/window 指针与快捷键；detach 时卸监听。 */
export function createPointerController(deps: PointerControllerDeps): PointerController {
  let activeInteraction: ActivePointerInteraction | undefined
  let spacePressed = false
  let groupResizeActive = false

  const {
    coreEditor,
    session,
    getSessionState,
    getCurrentStore,
    isPreviewActive,
    shell,
    workspace,
    board,
    overlay,
    canvas,
  } = deps

  const startPointerInteraction = (
    event: PointerEvent,
    node: NodeRecord,
    element: HTMLElement,
    captureTarget: Element,
    kind: "move" | "resize",
  ): void => {
    const sessionState = getSessionState()
    const currentStore = getCurrentStore()
    if (
      isPreviewActive() ||
      event.button !== 0 ||
      shell.dataset.mode !== "stage-edit" ||
      isTransformLocked(currentStore, node)
    )
      return

    activeInteraction?.cancel()
    shell.focus()
    if (hasSelectionModifier(event)) {
      session.setSelection(toggleSelection(sessionState.selection, node.id))
      event.preventDefault()
      return
    }
    if (!sessionState.selection.includes(node.id)) session.setSelection([node.id])
    event.preventDefault()

    const moveIds =
      kind === "move"
        ? (sessionState.selection.includes(node.id) ? sessionState.selection : [node.id]).filter(
            (id) => {
              const selected = currentStore.get(id)
              return selected?.typeName === "node" && !isTransformLocked(currentStore, selected)
            },
          )
        : [node.id]
    const moveIdSet = new Set(moveIds)
    const previewElements =
      kind === "move"
        ? moveIds.flatMap((id) => {
            const selected = currentStore.get(id)
            if (selected?.typeName !== "node") return []
            let parent = currentStore.get(selected.parentId)
            while (parent?.typeName === "node") {
              if (moveIdSet.has(parent.id)) return []
              parent = currentStore.get(parent.parentId)
            }
            const selectedElement = canvas.nodeElements.get(id)
            return selectedElement === undefined ? [] : [selectedElement]
          })
        : [element]

    const startScreen = { x: event.clientX, y: event.clientY }
    const startLocal =
      kind === "move"
        ? { x: node.layout.x, y: node.layout.y }
        : { x: node.layout.width, y: node.layout.height }
    let pointerSession: PointerMoveSession
    try {
      pointerSession = createPointerMoveSession(startScreen, startLocal, sessionState.viewport.zoom)
    } catch {
      return
    }

    const pointerId = event.pointerId
    let ended = false
    const matchesPointer = (nextEvent: PointerEvent): boolean =>
      pointerId === undefined ||
      nextEvent.pointerId === undefined ||
      nextEvent.pointerId === pointerId
    const restorePreview = (): void => {
      if (kind === "move") {
        for (const previewElement of previewElements) {
          previewElement.style.removeProperty("transform")
        }
        setSelectionOutlinePreview(overlay, undefined)
      } else {
        element.style.width = `${node.layout.width}px`
        element.style.height = `${node.layout.height}px`
      }
    }
    const removeListeners = (): void => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerCancel)
      window.removeEventListener("keydown", onInteractionKeyDown)
      window.removeEventListener("blur", onWindowBlur)
      captureTarget.removeEventListener("lostpointercapture", onLostPointerCapture)
    }
    const cancel = (): void => {
      if (ended) return
      ended = true
      removeListeners()
      restorePreview()
      if (activeInteraction?.cancel === cancel) activeInteraction = undefined
      if (typeof captureTarget.releasePointerCapture === "function") {
        try {
          captureTarget.releasePointerCapture(pointerId)
        } catch {
          // Capture may already be gone when the browser reports lostpointercapture.
        }
      }
    }
    const updatePreview = (nextEvent: PointerEvent): boolean => {
      if (!matchesPointer(nextEvent)) return false
      try {
        pointerSession.update({ x: nextEvent.clientX, y: nextEvent.clientY })
        const preview = pointerSession.preview()
        if (kind === "move") {
          const offset = { x: preview.x - node.layout.x, y: preview.y - node.layout.y }
          const transform = `translate(${offset.x}px, ${offset.y}px)`
          for (const previewElement of previewElements) {
            previewElement.style.transform = transform
          }
          setSelectionOutlinePreview(overlay, {
            x: offset.x * getSessionState().viewport.zoom,
            y: offset.y * getSessionState().viewport.zoom,
          })
        } else {
          element.style.width = `${Math.max(1, preview.x)}px`
          element.style.height = `${Math.max(1, preview.y)}px`
        }
        return true
      } catch {
        cancel()
        return false
      }
    }
    function onPointerMove(nextEvent: PointerEvent): void {
      updatePreview(nextEvent)
    }
    const commitPreview = (): void => {
      const delta = pointerSession.commit()
      cancel()
      if (kind === "move") {
        if (delta.x === 0 && delta.y === 0) return
        coreEditor.dispatch({ id: "node.move", payload: { ids: moveIds, delta } })
        return
      }
      const width = Math.max(1, node.layout.width + delta.x)
      const height = Math.max(1, node.layout.height + delta.y)
      if (width === node.layout.width && height === node.layout.height) return
      coreEditor.dispatch({ id: "node.resize", payload: { id: node.id, width, height } })
    }
    function onPointerUp(nextEvent: PointerEvent): void {
      if (updatePreview(nextEvent)) commitPreview()
    }
    function onPointerCancel(nextEvent: PointerEvent): void {
      if (matchesPointer(nextEvent)) cancel()
    }
    function onLostPointerCapture(nextEvent: Event): void {
      if (matchesPointer(nextEvent as PointerEvent)) commitPreview()
    }
    function onWindowBlur(): void {
      cancel()
    }
    function onInteractionKeyDown(keyEvent: KeyboardEvent): void {
      if (keyEvent.key === "Escape") cancel()
    }

    activeInteraction = { cancel }
    if (typeof captureTarget.setPointerCapture === "function") {
      try {
        captureTarget.setPointerCapture(pointerId)
      } catch {
        // Synthetic events and partial DOM implementations may not support active capture.
      }
    }
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerCancel)
    window.addEventListener("keydown", onInteractionKeyDown)
    window.addEventListener("blur", onWindowBlur)
    captureTarget.addEventListener("lostpointercapture", onLostPointerCapture)
  }

  const startGroupResizeInteraction = (event: PointerEvent, handle: GroupResizeHandle): void => {
    if (isPreviewActive() || event.button !== 0 || shell.dataset.mode !== "stage-edit") return
    const sessionState = getSessionState()
    const currentStore = getCurrentStore()
    const group = getGroupSelection(currentStore, canvas.visibleNodes, sessionState)
    if (group === undefined) return

    activeInteraction?.cancel()
    groupResizeActive = true
    shell.focus()
    event.preventDefault()

    const initialItems = group.items.map((item) => ({ ...item }))
    const initialBounds = selectionBounds(initialItems)
    const startScreen = workspacePoint(event, workspace)
    const pointerWorld = screenToWorld(startScreen, sessionState.viewport)
    const startLocal = {
      x: pointerWorld.x - group.parentWorldX,
      y: pointerWorld.y - group.parentWorldY,
    }
    let pointerSession: PointerMoveSession
    try {
      pointerSession = createPointerMoveSession(startScreen, startLocal, sessionState.viewport.zoom)
    } catch {
      return
    }

    const pointerId = event.pointerId
    let ended = false
    const matchesPointer = (nextEvent: PointerEvent): boolean =>
      pointerId === undefined ||
      nextEvent.pointerId === undefined ||
      nextEvent.pointerId === pointerId
    const restorePreview = (): void => {
      for (const item of initialItems) {
        const element = canvas.nodeElements.get(item.id)
        const node = getCurrentStore().get(item.id)
        if (element !== undefined && node?.typeName === "node") applyNodeStyle(element, node)
      }
      renderSelectionOverlay(overlay, getCurrentStore(), canvas.visibleNodes, getSessionState())
    }
    const removeListeners = (): void => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerCancel)
      window.removeEventListener("keydown", onInteractionKeyDown)
      window.removeEventListener("blur", onWindowBlur)
      overlay.removeEventListener("lostpointercapture", onLostPointerCapture)
    }
    const cancel = (): void => {
      if (ended) return
      ended = true
      groupResizeActive = false
      removeListeners()
      restorePreview()
      if (activeInteraction?.cancel === cancel) activeInteraction = undefined
      if (typeof overlay.releasePointerCapture === "function") {
        try {
          overlay.releasePointerCapture(pointerId)
        } catch {
          // Capture may already be gone when the browser reports lostpointercapture.
        }
      }
    }
    const updatePreview = (nextEvent: PointerEvent): boolean => {
      if (!matchesPointer(nextEvent)) return false
      try {
        pointerSession.update(workspacePoint(nextEvent, workspace))
        const resized = resizeGroup(initialItems, initialBounds, handle, pointerSession.preview())
        for (const item of resized.items) {
          const element = canvas.nodeElements.get(item.id)
          if (element === undefined) continue
          element.style.left = `${item.x}px`
          element.style.top = `${item.y}px`
          element.style.width = `${item.width}px`
          element.style.height = `${item.height}px`
        }
        renderSelectionOverlay(overlay, getCurrentStore(), canvas.visibleNodes, getSessionState(), {
          items: resized.items,
          bounds: resized.bounds,
          parentWorldX: group.parentWorldX,
          parentWorldY: group.parentWorldY,
        })
        return true
      } catch {
        cancel()
        return false
      }
    }
    function onPointerMove(nextEvent: PointerEvent): void {
      updatePreview(nextEvent)
    }
    const commitPreview = (): void => {
      const resized = resizeGroup(initialItems, initialBounds, handle, pointerSession.preview())
      const changed = resized.items.some((item, index) => {
        const initial = initialItems[index]!
        return (
          item.x !== initial.x ||
          item.y !== initial.y ||
          item.width !== initial.width ||
          item.height !== initial.height
        )
      })
      cancel()
      if (!changed) return
      if (resized.items.length === 1) {
        const item = resized.items[0]!
        coreEditor.dispatch({
          id: "node.resize",
          payload: { id: item.id, x: item.x, y: item.y, width: item.width, height: item.height },
        })
      } else {
        coreEditor.dispatch({ id: "node.resizeMany", payload: { items: resized.items } })
      }
    }
    function onPointerUp(nextEvent: PointerEvent): void {
      if (updatePreview(nextEvent)) commitPreview()
    }
    function onPointerCancel(nextEvent: PointerEvent): void {
      if (matchesPointer(nextEvent)) cancel()
    }
    function onLostPointerCapture(nextEvent: Event): void {
      if (matchesPointer(nextEvent as PointerEvent)) commitPreview()
    }
    function onWindowBlur(): void {
      cancel()
    }
    function onInteractionKeyDown(keyEvent: KeyboardEvent): void {
      if (keyEvent.key === "Escape") cancel()
    }

    activeInteraction = { cancel }
    if (typeof overlay.setPointerCapture === "function") {
      try {
        overlay.setPointerCapture(pointerId)
      } catch {
        // Synthetic events and partial DOM implementations may not support active capture.
      }
    }
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerCancel)
    window.addEventListener("keydown", onInteractionKeyDown)
    window.addEventListener("blur", onWindowBlur)
    overlay.addEventListener("lostpointercapture", onLostPointerCapture)
  }

  const onOverlayPointerDown = (event: PointerEvent): void => {
    if (isPreviewActive()) return
    const target = event.target
    if (!(target instanceof Element)) return
    const handle = target.closest<SVGElement>("[data-group-resize-handle]")?.dataset
      .groupResizeHandle
    if (handle === undefined || !GROUP_RESIZE_HANDLES.includes(handle as GroupResizeHandle)) return
    event.stopPropagation()
    startGroupResizeInteraction(event, handle as GroupResizeHandle)
  }

  const panOptions = {
    session,
    getSessionState,
    isPreviewActive,
    shell,
    workspace,
    getActiveInteraction: () => activeInteraction,
    setActiveInteraction: (next: ActivePointerInteraction | undefined) => {
      activeInteraction = next
    },
  }

  const marqueeOptions = {
    ...panOptions,
    overlay,
    canvas,
  }

  const onBoardPointerDown = (event: PointerEvent): void => {
    if (isPreviewActive()) return
    const sessionState = getSessionState()
    if (sessionState.interactionMode === "pan") {
      beginWorkspacePan(event, panOptions)
      return
    }
    if (shell.dataset.mode === "stage-edit" && (spacePressed || event.pointerType === "touch")) {
      beginWorkspacePan(event, panOptions)
      return
    }
    const target = event.target
    if (!(target instanceof Element)) return
    const nodeElement = target.closest<HTMLElement>("[data-node-id]")
    if (nodeElement === null) return
    const id = nodeElement.dataset.nodeId
    if (id === undefined) return
    const record = getCurrentStore().get(id)
    if (record?.typeName !== "node" || record.nodeType !== "rectangle") return
    startPointerInteraction(event, record, nodeElement, target, "move")
  }

  const onWorkspacePointerDown = (event: PointerEvent): void => {
    if (isPreviewActive() || event.defaultPrevented || shell.dataset.mode !== "stage-edit") return
    const sessionState = getSessionState()
    if (sessionState.interactionMode === "pan") {
      beginWorkspacePan(event, panOptions)
      return
    }
    if (spacePressed || event.pointerType === "touch" || event.button === 1) {
      beginWorkspacePan(event, panOptions)
      return
    }
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest("[data-node-id]")) return
    beginMarqueeSelection(event, marqueeOptions)
  }

  const onWorkspaceWheel = (event: WheelEvent): void => {
    if (isPreviewActive() || shell.dataset.mode !== "stage-edit") return
    event.preventDefault()
    const sessionState = getSessionState()
    const point = workspacePoint(event, workspace)
    const factor = Math.exp(-event.deltaY * 0.001)
    const nextZoom = Math.min(4, Math.max(0.1, sessionState.viewport.zoom * factor))
    session.setViewport(zoomAt(sessionState.viewport, point, nextZoom))
  }

  const onWindowKeyDown = (event: KeyboardEvent): void => {
    if (isPreviewActive()) return
    if (event.key !== " " && event.code !== "Space") return
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    event.preventDefault()
    spacePressed = true
    shell.dataset.panning = "true"
  }

  const onShellKeyDown = (event: KeyboardEvent): void => {
    if (isPreviewActive()) return
    const target = event.target
    if (event.key === "Delete" && target instanceof Element) {
      const treeControl = target.closest<HTMLElement>("[data-tree-control='select']")
      const id = treeControl?.dataset.treeId
      const record = id === undefined ? undefined : getCurrentStore().get(id)
      if (record?.typeName === "node") {
        event.preventDefault()
        const result = coreEditor.dispatch({ id: "node.delete", payload: { ids: [record.id] } })
        if (result.ok) {
          session.setSelection([])
          shell.focus()
        }
      }
      return
    }
    if (document.activeElement !== shell) return
    const key = event.key.toLowerCase()
    if (!event.metaKey && !event.ctrlKey) return
    const undo = key === "z" && !event.shiftKey
    const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey)
    if (!undo && !redo) return
    event.preventDefault()
    if (redo) coreEditor.redo()
    else coreEditor.undo()
  }

  const onWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== " " && event.code !== "Space") return
    spacePressed = false
    delete shell.dataset.panning
  }

  const onWindowBlur = (): void => {
    spacePressed = false
    delete shell.dataset.panning
  }

  return {
    isGroupResizeActive: () => groupResizeActive,
    cancelActive: () => {
      activeInteraction?.cancel()
    },
    attach() {
      board.addEventListener("pointerdown", onBoardPointerDown)
      overlay.addEventListener("pointerdown", onOverlayPointerDown)
      workspace.addEventListener("pointerdown", onWorkspacePointerDown)
      workspace.addEventListener("wheel", onWorkspaceWheel, { passive: false })
      shell.addEventListener("keydown", onShellKeyDown)
      window.addEventListener("keydown", onWindowKeyDown)
      window.addEventListener("keyup", onWindowKeyUp)
      window.addEventListener("blur", onWindowBlur)
    },
    detach() {
      board.removeEventListener("pointerdown", onBoardPointerDown)
      overlay.removeEventListener("pointerdown", onOverlayPointerDown)
      workspace.removeEventListener("pointerdown", onWorkspacePointerDown)
      workspace.removeEventListener("wheel", onWorkspaceWheel)
      shell.removeEventListener("keydown", onShellKeyDown)
      window.removeEventListener("keydown", onWindowKeyDown)
      window.removeEventListener("keyup", onWindowKeyUp)
      window.removeEventListener("blur", onWindowBlur)
    },
  }
}
