/**
 * @module pointer
 *
 * 画布指针状态机：move/resize/group-resize → session 或单次 dispatch。
 * pan/marquee 见 pointer-pan / pointer-marquee。
 *
 * 边界：
 * - 拖拽中只改 DOM 预览与 session；松手再 dispatch
 * - 通过注入 deps 访问 board/overlay，避免与 mount 循环依赖
 * - Free Layout 吸附：snapEnabled 且未按 Alt 时，preview/commit 使用同一套 snapped 几何
 *
 * 数据流：pointerdown → session 预览（可选 snap）→ pointerup → coreEditor.dispatch
 */

import type { Editor, NodeRecord, RecordStore } from "@composeui/core"
import { screenToWorld, zoomAt } from "../session/coordinates"
import type { EditorSession } from "../session/session"
import type { EditorSessionState } from "../session/session"
import { snapPoint, snapRect } from "../session/snap"
import { applyNodeStyle, isTransformLocked, type CanvasView } from "./board-render"
import { resizeGroup, selectionBounds } from "./group-resize"
import type { GroupBounds, GroupResizeHandle, GroupResizeItem } from "./group-resize"
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

/** 吸附开启且未临时按 Alt 时才量化；gridVisible 不影响吸附。 */
export function shouldSnap(
  session: Pick<EditorSessionState, "snapEnabled">,
  event: { altKey?: boolean },
): boolean {
  return session.snapEnabled && event.altKey !== true
}

/** 将组缩放手柄映射为 snapRect 应量化的边。 */
export function edgesForResizeHandle(handle: GroupResizeHandle): {
  left?: boolean
  top?: boolean
  right?: boolean
  bottom?: boolean
} {
  return {
    left: handle.includes("w"),
    right: handle.includes("e"),
    top: handle.includes("n"),
    bottom: handle.includes("s"),
  }
}

/**
 * 对 group-resize 结果做边相关吸附。
 * 单节点：直接 snapRect 该项；多选：吸附包围盒后再按比例映射子项。
 */
export function snapGroupResizeResult(
  resized: { bounds: GroupBounds; items: GroupResizeItem[] },
  handle: GroupResizeHandle,
  step: number,
  initial: GroupBounds,
  initialItems: readonly GroupResizeItem[],
): { bounds: GroupBounds; items: GroupResizeItem[] } {
  const edges = edgesForResizeHandle(handle)
  if (resized.items.length === 1) {
    const item = resized.items[0]!
    const snapped = snapRect(
      { x: item.x, y: item.y, width: item.width, height: item.height },
      step,
      edges,
    )
    return {
      bounds: {
        left: snapped.x,
        top: snapped.y,
        right: snapped.x + snapped.width,
        bottom: snapped.y + snapped.height,
      },
      items: [{ id: item.id, ...snapped }],
    }
  }

  const snapped = snapRect(
    {
      x: resized.bounds.left,
      y: resized.bounds.top,
      width: resized.bounds.right - resized.bounds.left,
      height: resized.bounds.bottom - resized.bounds.top,
    },
    step,
    edges,
  )
  const bounds: GroupBounds = {
    left: snapped.x,
    top: snapped.y,
    right: snapped.x + snapped.width,
    bottom: snapped.y + snapped.height,
  }
  const scaleX = (bounds.right - bounds.left) / (initial.right - initial.left)
  const scaleY = (bounds.bottom - bounds.top) / (initial.bottom - initial.top)
  return {
    bounds,
    items: initialItems.map((item) => ({
      id: item.id,
      x: bounds.left + (item.x - initial.left) * scaleX,
      y: bounds.top + (item.y - initial.top) * scaleY,
      width: Math.max(1, item.width * scaleX),
      height: Math.max(1, item.height * scaleY),
    })),
  }
}

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
    // 与 preview 一致的最终几何，避免 Alt/吸附在 commit 时跳动
    let lastMoveDelta = { x: 0, y: 0 }
    let lastResizeSize = { width: node.layout.width, height: node.layout.height }
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
        const liveSession = getSessionState()
        const snap = shouldSnap(liveSession, nextEvent)
        if (kind === "move") {
          // 吸附主拖拽节点的绝对 parent-local，再反算统一 delta 给 node.move
          const target = snap
            ? snapPoint({ x: preview.x, y: preview.y }, liveSession.gridSize)
            : { x: preview.x, y: preview.y }
          const offset = { x: target.x - node.layout.x, y: target.y - node.layout.y }
          lastMoveDelta = offset
          const transform = `translate(${offset.x}px, ${offset.y}px)`
          for (const previewElement of previewElements) {
            previewElement.style.transform = transform
          }
          setSelectionOutlinePreview(overlay, {
            x: offset.x * liveSession.viewport.zoom,
            y: offset.y * liveSession.viewport.zoom,
          })
        } else {
          let width = Math.max(1, preview.x)
          let height = Math.max(1, preview.y)
          if (snap) {
            const snapped = snapRect(
              { x: node.layout.x, y: node.layout.y, width, height },
              liveSession.gridSize,
              { right: true, bottom: true },
            )
            width = snapped.width
            height = snapped.height
          }
          lastResizeSize = { width, height }
          element.style.width = `${width}px`
          element.style.height = `${height}px`
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
      cancel()
      if (kind === "move") {
        if (lastMoveDelta.x === 0 && lastMoveDelta.y === 0) return
        coreEditor.dispatch({ id: "node.move", payload: { ids: moveIds, delta: lastMoveDelta } })
        return
      }
      if (
        lastResizeSize.width === node.layout.width &&
        lastResizeSize.height === node.layout.height
      ) {
        return
      }
      coreEditor.dispatch({
        id: "node.resize",
        payload: {
          id: node.id,
          width: lastResizeSize.width,
          height: lastResizeSize.height,
        },
      })
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
    let lastResized: { bounds: GroupBounds; items: GroupResizeItem[] } = {
      bounds: initialBounds,
      items: initialItems,
    }
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
    const resolveResized = (nextEvent: PointerEvent) => {
      pointerSession.update(workspacePoint(nextEvent, workspace))
      let resized = resizeGroup(initialItems, initialBounds, handle, pointerSession.preview())
      const liveSession = getSessionState()
      if (shouldSnap(liveSession, nextEvent)) {
        resized = snapGroupResizeResult(
          resized,
          handle,
          liveSession.gridSize,
          initialBounds,
          initialItems,
        )
      }
      return resized
    }
    const updatePreview = (nextEvent: PointerEvent): boolean => {
      if (!matchesPointer(nextEvent)) return false
      try {
        const resized = resolveResized(nextEvent)
        lastResized = resized
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
      const resized = lastResized
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
