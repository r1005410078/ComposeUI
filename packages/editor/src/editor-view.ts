import type { Editor, NodeRecord, PageRecord, RecordStore } from "@composeui/core"
import type { EditorChangeEvent, TransactionPatch } from "@composeui/core"
import { safeColor } from "./colors"
import { worldToScreen, zoomAt } from "./coordinates"
import { createComponentTree } from "./component-tree"
import { createPointerMoveSession } from "./interactions"
import type { PointerMoveSession } from "./interactions"
import { EditorSession } from "./session"
import type { EditorSessionState } from "./session"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
const SAFE_PAGE_BACKGROUND = "#ffffff"
const SAFE_NODE_FILL = "#2563eb"

export interface MountEditorOptions {
  pageId: string
}

export interface MountedEditor {
  session: EditorSession
  destroy(): void
}

interface VisibleNode {
  node: NodeRecord
  worldX: number
  worldY: number
}

interface CanvasView {
  board: HTMLElement
  world: HTMLElement
  overlay: SVGSVGElement
  children: Map<string, NodeRecord[]>
  visibleNodes: Map<string, VisibleNode>
  nodeElements: Map<string, HTMLElement>
  update(store: RecordStore, page: PageRecord, rebuild: boolean): void
}

interface ActivePointerInteraction {
  cancel(): void
}

function indexChildren(store: RecordStore): Map<string, NodeRecord[]> {
  const children = new Map<string, NodeRecord[]>()
  for (const record of store.all()) {
    if (record.typeName !== "node") continue
    const siblings = children.get(record.parentId) ?? []
    siblings.push(record)
    children.set(record.parentId, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.index.localeCompare(right.index))
  }
  return children
}

function applyNodeStyle(element: HTMLElement, node: NodeRecord): void {
  Object.assign(element.style, {
    position: "absolute",
    left: `${node.layout.x}px`,
    top: `${node.layout.y}px`,
    width: `${node.layout.width}px`,
    height: `${node.layout.height}px`,
    background: safeColor(node.props.fill, SAFE_NODE_FILL),
  })
}

function applyPageStyle(board: HTMLElement, page: PageRecord): void {
  Object.assign(board.style, {
    width: `${page.width}px`,
    height: `${page.height}px`,
    background: safeColor(page.background, SAFE_PAGE_BACKGROUND),
    overflow: page.overflow,
  })
}

function findResizeHandle(element: HTMLElement): HTMLElement | undefined {
  return [...element.children].find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.resizeNodeId !== undefined,
  )
}

function syncResizeHandle(element: HTMLElement, node: NodeRecord, transformLocked: boolean): void {
  const existing = findResizeHandle(element)
  if (transformLocked) {
    existing?.remove()
    return
  }
  if (existing !== undefined) return

  const handle = document.createElement("span")
  handle.className = "composeui-editor__resize-handle composeui-editor__resize-handle--se"
  handle.dataset.testid = `resize-${node.id}-se`
  handle.dataset.resizeNodeId = node.id
  handle.setAttribute("aria-hidden", "true")
  element.append(handle)
}

function createNodeElement(node: NodeRecord, transformLocked: boolean): HTMLElement {
  const element = document.createElement("div")
  element.className = "composeui-editor__node"
  element.dataset.nodeId = node.id
  applyNodeStyle(element, node)
  syncResizeHandle(element, node, transformLocked)
  return element
}

function renderNode(
  node: NodeRecord,
  children: ReadonlyMap<string, readonly NodeRecord[]>,
  visibleNodes: Map<string, VisibleNode>,
  nodeElements: Map<string, HTMLElement>,
  parentWorldX: number,
  parentWorldY: number,
  parentLocked: boolean,
): HTMLElement | undefined {
  if (!node.visible) return undefined

  const transformLocked = parentLocked || node.locked
  const element = createNodeElement(node, transformLocked)
  nodeElements.set(node.id, element)
  const worldX = parentWorldX + node.layout.x
  const worldY = parentWorldY + node.layout.y
  visibleNodes.set(node.id, { node, worldX, worldY })
  for (const child of children.get(node.id) ?? []) {
    const childElement = renderNode(
      child,
      children,
      visibleNodes,
      nodeElements,
      worldX,
      worldY,
      transformLocked,
    )
    if (childElement !== undefined) element.append(childElement)
  }
  return element
}

function collectVisibleNodes(
  node: NodeRecord,
  children: ReadonlyMap<string, readonly NodeRecord[]>,
  visibleNodes: Map<string, VisibleNode>,
  nodeElements: ReadonlyMap<string, HTMLElement>,
  parentWorldX: number,
  parentWorldY: number,
  parentLocked: boolean,
): void {
  if (!node.visible) return
  const transformLocked = parentLocked || node.locked
  const worldX = parentWorldX + node.layout.x
  const worldY = parentWorldY + node.layout.y
  visibleNodes.set(node.id, { node, worldX, worldY })
  const element = nodeElements.get(node.id)
  if (element !== undefined) {
    applyNodeStyle(element, node)
    syncResizeHandle(element, node, transformLocked)
  }
  for (const child of children.get(node.id) ?? []) {
    collectVisibleNodes(
      child,
      children,
      visibleNodes,
      nodeElements,
      worldX,
      worldY,
      transformLocked,
    )
  }
}

function renderSelectionOverlay(
  overlay: SVGSVGElement,
  visibleNodes: ReadonlyMap<string, VisibleNode>,
  state: EditorSessionState,
): void {
  for (const outline of overlay.querySelectorAll("[data-selection-outline]")) outline.remove()
  const fragment = document.createDocumentFragment()
  for (const id of state.selection) {
    const selected = visibleNodes.get(id)
    if (selected === undefined) continue
    const origin = worldToScreen({ x: selected.worldX, y: selected.worldY }, state.viewport)
    const end = worldToScreen(
      {
        x: selected.worldX + selected.node.layout.width,
        y: selected.worldY + selected.node.layout.height,
      },
      state.viewport,
    )
    const rect = document.createElementNS(SVG_NAMESPACE, "rect")
    rect.dataset.testid = `selection-${id}`
    rect.dataset.selectionOutline = "true"
    rect.setAttribute("x", String(origin.x))
    rect.setAttribute("y", String(origin.y))
    rect.setAttribute("width", String(end.x - origin.x))
    rect.setAttribute("height", String(end.y - origin.y))
    fragment.append(rect)
  }
  overlay.append(fragment)
}

function hasSelectionModifier(
  event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey
}

function toggleSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id)
    ? selection.filter((selectedId) => selectedId !== id)
    : [...selection, id]
}

function workspacePoint(event: MouseEvent, workspace: HTMLElement): { x: number; y: number } {
  const bounds = workspace.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

function createCanvasView(
  store: RecordStore,
  page: PageRecord,
  world: HTMLElement,
  board: HTMLElement,
  overlay: SVGSVGElement,
): CanvasView {
  const canvas: CanvasView = {
    board,
    world,
    overlay,
    children: indexChildren(store),
    visibleNodes: new Map(),
    nodeElements: new Map(),
    update(nextStore, nextPage, rebuild) {
      applyPageStyle(board, nextPage)
      canvas.children = indexChildren(nextStore)
      if (rebuild) {
        canvas.visibleNodes.clear()
        canvas.nodeElements.clear()
        const fragment = document.createDocumentFragment()
        for (const node of canvas.children.get(nextPage.id) ?? []) {
          const element = renderNode(
            node,
            canvas.children,
            canvas.visibleNodes,
            canvas.nodeElements,
            0,
            0,
            false,
          )
          if (element !== undefined) fragment.append(element)
        }
        board.replaceChildren(fragment)
        return
      }

      canvas.visibleNodes.clear()
      for (const node of canvas.children.get(nextPage.id) ?? []) {
        collectVisibleNodes(
          node,
          canvas.children,
          canvas.visibleNodes,
          canvas.nodeElements,
          0,
          0,
          false,
        )
      }
    },
  }

  applyPageStyle(board, page)
  const fragment = document.createDocumentFragment()
  for (const node of canvas.children.get(page.id) ?? []) {
    const element = renderNode(
      node,
      canvas.children,
      canvas.visibleNodes,
      canvas.nodeElements,
      0,
      0,
      false,
    )
    if (element !== undefined) fragment.append(element)
  }
  board.replaceChildren(fragment)
  return canvas
}

function treeNeedsUpdate(patch: TransactionPatch): boolean {
  if (patch.created.length > 0 || patch.removed.length > 0) return true
  return patch.updated.some(({ before, after }) => {
    if (before.typeName !== after.typeName) return true
    if (before.typeName === "page" && after.typeName === "page") {
      return before.name !== after.name
    }
    if (before.typeName !== "node" || after.typeName !== "node") return false
    return (
      before.name !== after.name ||
      before.parentId !== after.parentId ||
      before.index !== after.index ||
      before.visible !== after.visible ||
      before.locked !== after.locked
    )
  })
}

function canvasNeedsRebuild(patch: TransactionPatch): boolean {
  if (patch.created.length > 0 || patch.removed.length > 0) return true
  return patch.updated.some(({ before, after }) => {
    if (before.typeName !== "node" || after.typeName !== "node") return false
    return (
      before.parentId !== after.parentId ||
      before.index !== after.index ||
      before.visible !== after.visible
    )
  })
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function mountEditor(
  root: HTMLElement,
  coreEditor: Editor,
  options: MountEditorOptions,
): MountedEditor {
  const initialPage = coreEditor.getRecord(options.pageId)
  if (initialPage?.typeName !== "page") throw new Error("PAGE_NOT_FOUND")

  const session = new EditorSession()
  session.toggleExpanded(options.pageId)
  let sessionState = session.getState()

  const shell = document.createElement("section")
  shell.className = "composeui-editor"
  shell.dataset.testid = "editor-shell"
  shell.dataset.mode = "stage-edit"
  shell.tabIndex = 0
  const aside = document.createElement("aside")
  aside.className = "composeui-editor__component-tree"
  aside.setAttribute("aria-label", "Component tree")
  const workspace = document.createElement("main")
  workspace.className = "composeui-editor__workspace"
  workspace.dataset.testid = "workspace"
  workspace.setAttribute("aria-label", "Workspace")
  const world = document.createElement("div")
  world.className = "composeui-editor__world"
  world.dataset.testid = "world"
  const board = document.createElement("section")
  board.className = "composeui-editor__page-board"
  board.dataset.testid = "page-board"
  board.setAttribute("aria-label", "Page board")
  const overlay = document.createElementNS(SVG_NAMESPACE, "svg")
  overlay.classList.add("composeui-editor__selection-overlay")
  overlay.dataset.testid = "selection-overlay"
  overlay.setAttribute("aria-label", "Selection overlay")
  const grid = document.createElement("div")
  grid.className = "composeui-editor__workspace-grid"
  grid.dataset.testid = "workspace-grid"
  grid.setAttribute("aria-hidden", "true")

  const tree = createComponentTree(
    coreEditor.getStore(),
    options.pageId,
    sessionState,
    session,
    coreEditor,
  )
  aside.append(tree.element)
  world.append(board)
  workspace.append(grid, world, overlay)
  shell.append(aside, workspace)
  root.replaceChildren(shell)

  let currentStore = coreEditor.getStore()
  const canvas = createCanvasView(currentStore, initialPage, world, board, overlay)
  const updateViewport = (): void => {
    world.style.transform = `translate(${sessionState.viewport.x}px, ${sessionState.viewport.y}px) scale(${sessionState.viewport.zoom})`
    const gridSize = 16 * sessionState.viewport.zoom
    grid.style.backgroundPosition = `${sessionState.viewport.x}px ${sessionState.viewport.y}px`
    grid.style.backgroundSize = `${gridSize}px ${gridSize}px`
    grid.hidden = !sessionState.gridVisible
  }
  updateViewport()
  renderSelectionOverlay(overlay, canvas.visibleNodes, sessionState)

  let destroyed = false
  let activeInteraction: ActivePointerInteraction | undefined

  const isTransformLocked = (node: NodeRecord): boolean => {
    let current: NodeRecord | undefined = node
    while (current !== undefined) {
      if (current.locked) return true
      const parent = currentStore.get(current.parentId)
      current = parent?.typeName === "node" ? parent : undefined
    }
    return false
  }

  const startPointerInteraction = (
    event: PointerEvent,
    node: NodeRecord,
    element: HTMLElement,
    captureTarget: Element,
    kind: "move" | "resize",
  ): void => {
    if (event.button !== 0 || shell.dataset.mode !== "stage-edit" || isTransformLocked(node)) return

    activeInteraction?.cancel()
    shell.focus()
    if (hasSelectionModifier(event)) {
      session.setSelection(toggleSelection(sessionState.selection, node.id))
      event.preventDefault()
      return
    }
    if (!sessionState.selection.includes(node.id)) session.setSelection([node.id])
    event.preventDefault()

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
        element.style.removeProperty("transform")
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
          element.style.transform = `translate(${preview.x - node.layout.x}px, ${preview.y - node.layout.y}px)`
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
    function onPointerUp(nextEvent: PointerEvent): void {
      if (!updatePreview(nextEvent)) return
      const delta = pointerSession.commit()
      cancel()
      if (kind === "move") {
        if (delta.x === 0 && delta.y === 0) return
        coreEditor.dispatch({ id: "node.move", payload: { ids: [node.id], delta } })
        return
      }
      const width = Math.max(1, node.layout.width + delta.x)
      const height = Math.max(1, node.layout.height + delta.y)
      if (width === node.layout.width && height === node.layout.height) return
      coreEditor.dispatch({ id: "node.resize", payload: { id: node.id, width, height } })
    }
    function onPointerCancel(nextEvent: PointerEvent): void {
      if (matchesPointer(nextEvent)) cancel()
    }
    function onLostPointerCapture(nextEvent: Event): void {
      if (matchesPointer(nextEvent as PointerEvent)) cancel()
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

  const onBoardPointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const handle = target.closest<HTMLElement>("[data-resize-node-id]")
    const nodeElement = target.closest<HTMLElement>("[data-node-id]")
    if (nodeElement === null) return
    const id = handle?.dataset.resizeNodeId ?? nodeElement.dataset.nodeId
    if (id === undefined) return
    const record = currentStore.get(id)
    if (record?.typeName !== "node" || record.nodeType !== "rectangle") return
    startPointerInteraction(event, record, nodeElement, target, handle === null ? "move" : "resize")
  }
  const startWorkspacePan = (event: PointerEvent): void => {
    activeInteraction?.cancel()
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY }
    const viewport = sessionState.viewport
    let ended = false
    const cancel = (): void => {
      if (ended) return
      ended = true
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
      if (activeInteraction?.cancel === cancel) activeInteraction = undefined
    }
    function onPointerMove(nextEvent: PointerEvent): void {
      session.setViewport({
        x: viewport.x + nextEvent.clientX - start.x,
        y: viewport.y + nextEvent.clientY - start.y,
        zoom: viewport.zoom,
      })
    }
    function onPointerUp(nextEvent: PointerEvent): void {
      onPointerMove(nextEvent)
      cancel()
    }
    activeInteraction = { cancel }
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerUp)
  }
  const startMarqueeSelection = (event: PointerEvent): void => {
    activeInteraction?.cancel()
    event.preventDefault()
    shell.focus()
    const start = workspacePoint(event, workspace)
    const initialSelection = sessionState.selection
    const additive = hasSelectionModifier(event)
    const marquee = document.createElementNS(SVG_NAMESPACE, "rect")
    marquee.dataset.testid = "marquee-selection"
    marquee.dataset.marquee = "true"
    overlay.append(marquee)
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
      if (activeInteraction?.cancel === cancel) activeInteraction = undefined
    }
    function onPointerMove(nextEvent: PointerEvent): void {
      current = workspacePoint(nextEvent, workspace)
      render()
    }
    function onPointerUp(nextEvent: PointerEvent): void {
      onPointerMove(nextEvent)
      const left = Math.min(start.x, current.x)
      const top = Math.min(start.y, current.y)
      const right = Math.max(start.x, current.x)
      const bottom = Math.max(start.y, current.y)
      const matches: string[] = []
      for (const [id, visible] of canvas.visibleNodes) {
        const origin = worldToScreen(
          { x: visible.worldX, y: visible.worldY },
          sessionState.viewport,
        )
        const end = worldToScreen(
          {
            x: visible.worldX + visible.node.layout.width,
            y: visible.worldY + visible.node.layout.height,
          },
          sessionState.viewport,
        )
        if (origin.x <= right && end.x >= left && origin.y <= bottom && end.y >= top) {
          matches.push(id)
        }
      }
      cancel()
      session.setSelection(additive ? [...new Set([...initialSelection, ...matches])] : matches)
    }
    function onPointerCancel(): void {
      cancel()
    }
    render()
    activeInteraction = { cancel }
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerCancel)
  }
  const onWorkspacePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented || shell.dataset.mode !== "stage-edit") return
    if (event.button === 1) {
      startWorkspacePan(event)
      return
    }
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest("[data-node-id]")) return
    startMarqueeSelection(event)
  }
  const onWorkspaceWheel = (event: WheelEvent): void => {
    if (shell.dataset.mode !== "stage-edit") return
    event.preventDefault()
    const point = workspacePoint(event, workspace)
    const factor = Math.exp(-event.deltaY * 0.001)
    const nextZoom = Math.min(4, Math.max(0.1, sessionState.viewport.zoom * factor))
    session.setViewport(zoomAt(sessionState.viewport, point, nextZoom))
  }
  const onShellKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (event.key === "Delete" && target instanceof Element) {
      const treeControl = target.closest<HTMLElement>("[data-tree-control='select']")
      const id = treeControl?.dataset.treeId
      const record = id === undefined ? undefined : currentStore.get(id)
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
  board.addEventListener("pointerdown", onBoardPointerDown)
  workspace.addEventListener("pointerdown", onWorkspacePointerDown)
  workspace.addEventListener("wheel", onWorkspaceWheel, { passive: false })
  shell.addEventListener("keydown", onShellKeyDown)

  const onCoreChange = (event: EditorChangeEvent): void => {
    if (destroyed) return
    activeInteraction?.cancel()
    currentStore = event.store
    const page = currentStore.get(options.pageId)
    if (page?.typeName !== "page") return
    canvas.update(currentStore, page, canvasNeedsRebuild(event.transaction.forward))
    if (treeNeedsUpdate(event.transaction.forward)) {
      tree.update(currentStore, options.pageId, sessionState, true)
    }
    renderSelectionOverlay(overlay, canvas.visibleNodes, sessionState)
  }
  const onSessionChange = (nextState: EditorSessionState): void => {
    if (destroyed) return
    const selectionChanged = !sameArray(sessionState.selection, nextState.selection)
    const viewportChanged =
      sessionState.viewport.x !== nextState.viewport.x ||
      sessionState.viewport.y !== nextState.viewport.y ||
      sessionState.viewport.zoom !== nextState.viewport.zoom
    const expandedChanged = !sameArray(sessionState.expanded, nextState.expanded)
    const gridChanged = sessionState.gridVisible !== nextState.gridVisible
    sessionState = nextState
    if (expandedChanged) tree.update(currentStore, options.pageId, nextState, true)
    else if (selectionChanged) tree.update(currentStore, options.pageId, nextState, false)
    if (viewportChanged || gridChanged) updateViewport()
    if (selectionChanged || viewportChanged) {
      renderSelectionOverlay(overlay, canvas.visibleNodes, nextState)
    }
  }

  const unsubscribeCore = coreEditor.subscribe(onCoreChange)
  const unsubscribeSession = session.subscribe(onSessionChange)

  return {
    session,
    destroy() {
      if (destroyed) return
      destroyed = true
      activeInteraction?.cancel()
      board.removeEventListener("pointerdown", onBoardPointerDown)
      workspace.removeEventListener("pointerdown", onWorkspacePointerDown)
      workspace.removeEventListener("wheel", onWorkspaceWheel)
      shell.removeEventListener("keydown", onShellKeyDown)
      unsubscribeCore()
      unsubscribeSession()
      shell.remove()
    },
  }
}
