import { createEditor } from "@composeui/core"
import type { Editor, NodeRecord, PageDocument, PageRecord, RecordStore } from "@composeui/core"
import type { EditorChangeEvent, TransactionPatch } from "@composeui/core"
import { safeColor } from "./colors"
import { screenToWorld, worldToScreen, zoomAt } from "./coordinates"
import { mountComponentTreeView, treeNeedsUpdate } from "./component-tree"
import type { MountedComponentTree } from "./component-tree"
import { resizeGroup, selectionBounds } from "./group-resize"
import type { GroupResizeHandle, GroupResizeItem } from "./group-resize"
import { createPointerMoveSession } from "./interactions"
import type { PointerMoveSession } from "./interactions"
import { EditorSession } from "./session"
import type { EditorSessionState } from "./session"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
const DEFAULT_PAGE_BACKGROUND = "#ffffff"
const SAFE_PAGE_BACKGROUND = "#ffffff"
const SAFE_NODE_FILL = "#2563eb"
const GROUP_RESIZE_HANDLES: readonly GroupResizeHandle[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
]

export interface MountEditorOptions {
  pageId: string
  session?: EditorSession
  view?: "combined" | "canvas"
  preview?: EditorPreviewSource
}

export interface EditorPreviewFrame {
  readonly active: boolean
  readonly document?: PageDocument
  readonly session?: EditorSessionState
  readonly currentSequence?: number
  readonly targetSequence?: number
}

export interface EditorPreviewSource {
  getState(): EditorPreviewFrame
  subscribe(listener: (frame: EditorPreviewFrame) => void): () => void
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

interface GroupSelectionPreview {
  items: GroupResizeItem[]
  bounds: ReturnType<typeof selectionBounds>
  parentWorldX: number
  parentWorldY: number
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
  const pageBackground = page.background.trim().toLowerCase()
  Object.assign(board.style, {
    width: `${page.width}px`,
    height: `${page.height}px`,
    background:
      pageBackground === DEFAULT_PAGE_BACKGROUND
        ? ""
        : safeColor(page.background, SAFE_PAGE_BACKGROUND),
    overflow: page.overflow,
  })
}

function createNodeElement(node: NodeRecord): HTMLElement {
  const element = document.createElement("div")
  element.className = "composeui-editor__node"
  element.dataset.nodeId = node.id
  applyNodeStyle(element, node)
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
  const element = createNodeElement(node)
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
  if (element !== undefined) applyNodeStyle(element, node)
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

function isTransformLocked(store: RecordStore, node: NodeRecord): boolean {
  let current: NodeRecord | undefined = node
  while (current !== undefined) {
    if (current.locked) return true
    const parent = store.get(current.parentId)
    current = parent?.typeName === "node" ? parent : undefined
  }
  return false
}

function getGroupSelection(
  store: RecordStore,
  visibleNodes: ReadonlyMap<string, VisibleNode>,
  state: EditorSessionState,
): { items: GroupResizeItem[]; parentWorldX: number; parentWorldY: number } | undefined {
  if (state.selection.length < 1) return undefined
  const selected = state.selection.map((id) => visibleNodes.get(id))
  if (selected.some((item) => item === undefined)) return undefined
  const visible = selected as VisibleNode[]
  const first = visible[0]!
  if (first.node.nodeType !== "rectangle" || isTransformLocked(store, first.node)) return undefined
  if (
    visible.some(
      (item) =>
        item.node.nodeType !== "rectangle" ||
        item.node.parentId !== first.node.parentId ||
        isTransformLocked(store, item.node),
    )
  ) {
    return undefined
  }
  return {
    items: visible.map(({ node }) => ({
      id: node.id,
      x: node.layout.x,
      y: node.layout.y,
      width: node.layout.width,
      height: node.layout.height,
    })),
    parentWorldX: first.worldX - first.node.layout.x,
    parentWorldY: first.worldY - first.node.layout.y,
  }
}

function renderSelectionOverlay(
  overlay: SVGSVGElement,
  store: RecordStore,
  visibleNodes: ReadonlyMap<string, VisibleNode>,
  state: EditorSessionState,
  preview?: GroupSelectionPreview,
): void {
  for (const element of overlay.querySelectorAll(
    "[data-selection-outline], [data-group-selection-frame], [data-group-resize-handle]",
  )) {
    element.remove()
  }
  const fragment = document.createDocumentFragment()
  const previewItems = new Map(preview?.items.map((item) => [item.id, item]))
  for (const id of state.selection) {
    const selected = visibleNodes.get(id)
    if (selected === undefined) continue
    const item = previewItems.get(id)
    const worldX = item === undefined ? selected.worldX : preview!.parentWorldX + item.x
    const worldY = item === undefined ? selected.worldY : preview!.parentWorldY + item.y
    const width = item?.width ?? selected.node.layout.width
    const height = item?.height ?? selected.node.layout.height
    const origin = worldToScreen({ x: worldX, y: worldY }, state.viewport)
    const end = worldToScreen(
      {
        x: worldX + width,
        y: worldY + height,
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

  const group = getGroupSelection(store, visibleNodes, state)
  if (group !== undefined) {
    const bounds = preview?.bounds ?? selectionBounds(group.items)
    const origin = worldToScreen(
      { x: group.parentWorldX + bounds.left, y: group.parentWorldY + bounds.top },
      state.viewport,
    )
    const end = worldToScreen(
      { x: group.parentWorldX + bounds.right, y: group.parentWorldY + bounds.bottom },
      state.viewport,
    )
    const frame = document.createElementNS(SVG_NAMESPACE, "rect")
    frame.dataset.testid = "group-selection-frame"
    frame.dataset.groupSelectionFrame = "true"
    frame.setAttribute("x", String(origin.x))
    frame.setAttribute("y", String(origin.y))
    frame.setAttribute("width", String(end.x - origin.x))
    frame.setAttribute("height", String(end.y - origin.y))
    fragment.append(frame)

    const centerX = (origin.x + end.x) / 2
    const centerY = (origin.y + end.y) / 2
    const positions: Record<GroupResizeHandle, { x: number; y: number }> = {
      n: { x: centerX, y: origin.y },
      ne: { x: end.x, y: origin.y },
      e: { x: end.x, y: centerY },
      se: { x: end.x, y: end.y },
      s: { x: centerX, y: end.y },
      sw: { x: origin.x, y: end.y },
      w: { x: origin.x, y: centerY },
      nw: { x: origin.x, y: origin.y },
    }
    for (const handle of GROUP_RESIZE_HANDLES) {
      const position = positions[handle]
      const element = document.createElementNS(SVG_NAMESPACE, "rect")
      element.classList.add("composeui-editor__group-resize-handle")
      element.dataset.testid = `group-resize-${handle}`
      element.dataset.groupResizeHandle = handle
      element.setAttribute("x", String(position.x - 4))
      element.setAttribute("y", String(position.y - 4))
      element.setAttribute("width", "8")
      element.setAttribute("height", "8")
      element.setAttribute("aria-hidden", "true")
      fragment.append(element)
    }
  }
  overlay.append(fragment)
}

function setSelectionOutlinePreview(
  overlay: SVGSVGElement,
  offset: { x: number; y: number } | undefined,
): void {
  for (const outline of overlay.querySelectorAll<SVGRectElement>(
    "[data-selection-outline], [data-group-selection-frame], [data-group-resize-handle]",
  )) {
    if (offset === undefined) outline.removeAttribute("transform")
    else outline.setAttribute("transform", `translate(${offset.x} ${offset.y})`)
  }
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
  return {
    x: event.clientX - bounds.left + workspace.scrollLeft,
    y: event.clientY - bounds.top + workspace.scrollTop,
  }
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

function previewStore(frame: EditorPreviewFrame): RecordStore | undefined {
  return frame.document === undefined ? undefined : createEditor(frame.document).getStore()
}

export function mountEditor(
  root: HTMLElement,
  coreEditor: Editor,
  options: MountEditorOptions,
): MountedEditor {
  const initialPage = coreEditor.getRecord(options.pageId)
  if (initialPage?.typeName !== "page") throw new Error("PAGE_NOT_FOUND")

  let previewFrame = options.preview?.getState() ?? { active: false }
  const session = options.session ?? new EditorSession()
  if (!previewFrame.active && !session.getState().expanded.includes(options.pageId)) {
    session.toggleExpanded(options.pageId)
  }
  let sourceSessionState = session.getState()
  let sessionState = previewFrame.active
    ? (previewFrame.session ?? sourceSessionState)
    : sourceSessionState
  const isPreviewActive = (): boolean => previewFrame.active
  const treeSessionState = (state: EditorSessionState): EditorSessionState =>
    state.expanded.includes(options.pageId)
      ? state
      : { ...state, expanded: [...state.expanded, options.pageId] }

  const shell = document.createElement("section")
  shell.className = "composeui-editor"
  if (options.view === "canvas") shell.classList.add("composeui-editor--canvas-only")
  shell.dataset.testid = "editor-shell"
  shell.dataset.mode = "stage-edit"
  shell.tabIndex = 0
  const aside = document.createElement("aside")
  aside.className = "composeui-editor__component-tree"
  aside.setAttribute("aria-label", "节点树")
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
  board.setAttribute("aria-label", "页面画布")
  const overlay = document.createElementNS(SVG_NAMESPACE, "svg")
  overlay.classList.add("composeui-editor__selection-overlay")
  overlay.dataset.testid = "selection-overlay"
  overlay.setAttribute("aria-label", "Selection overlay")
  const grid = document.createElement("div")
  grid.className = "composeui-editor__workspace-grid"
  grid.dataset.testid = "workspace-grid"
  grid.setAttribute("aria-hidden", "true")
  const replayBanner = document.createElement("div")
  replayBanner.dataset.testid = "replay-canvas-banner"
  replayBanner.setAttribute("role", "status")

  world.append(board)
  workspace.append(grid, world, overlay)
  if (options.view !== "canvas") shell.append(aside)
  shell.append(workspace)
  root.replaceChildren(shell)

  let sourceStore = coreEditor.getStore()
  let currentStore = previewFrame.active ? (previewStore(previewFrame) ?? sourceStore) : sourceStore

  const treeMounted: MountedComponentTree | undefined =
    options.view === "canvas"
      ? undefined
      : mountComponentTreeView(
          aside,
          coreEditor,
          {
            pageId: options.pageId,
            session,
            readOnly: isPreviewActive,
            ...(previewFrame.active
              ? { state: treeSessionState(sessionState), store: currentStore }
              : {}),
          },
          false,
        )

  const currentPage = currentStore.get(options.pageId)
  const canvas = createCanvasView(
    currentStore,
    currentPage?.typeName === "page" ? currentPage : initialPage,
    world,
    board,
    overlay,
  )
  const updateViewport = (): void => {
    world.style.transform = `translate(${sessionState.viewport.x}px, ${sessionState.viewport.y}px) scale(${sessionState.viewport.zoom})`
    const gridSize = 16 * sessionState.viewport.zoom
    grid.style.backgroundPosition = `${sessionState.viewport.x}px ${sessionState.viewport.y}px`
    grid.style.backgroundSize = `${gridSize}px ${gridSize}px`
    grid.hidden = !sessionState.gridVisible
  }
  updateViewport()
  renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)

  const updateReplayBanner = (): void => {
    if (!previewFrame.active) {
      delete shell.dataset.replay
      replayBanner.remove()
      return
    }
    shell.dataset.replay = "true"
    const sequences = [
      previewFrame.currentSequence === undefined
        ? undefined
        : `当前 #${previewFrame.currentSequence}`,
      previewFrame.targetSequence === undefined
        ? undefined
        : `目标 #${previewFrame.targetSequence}`,
    ].filter((sequence): sequence is string => sequence !== undefined)
    replayBanner.textContent = ["回放预览", ...sequences].join(" ")
    workspace.append(replayBanner)
  }
  updateReplayBanner()

  let destroyed = false
  let spacePressed = false
  let groupResizeActive = false
  let activeInteraction: ActivePointerInteraction | undefined

  const startPointerInteraction = (
    event: PointerEvent,
    node: NodeRecord,
    element: HTMLElement,
    captureTarget: Element,
    kind: "move" | "resize",
  ): void => {
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
            x: offset.x * sessionState.viewport.zoom,
            y: offset.y * sessionState.viewport.zoom,
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
        const node = currentStore.get(item.id)
        if (element !== undefined && node?.typeName === "node") applyNodeStyle(element, node)
      }
      renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
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
        renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState, {
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

  const onBoardPointerDown = (event: PointerEvent): void => {
    if (isPreviewActive()) return
    if (sessionState.interactionMode === "pan") {
      startWorkspacePan(event)
      return
    }
    if (shell.dataset.mode === "stage-edit" && (spacePressed || event.pointerType === "touch")) {
      startWorkspacePan(event)
      return
    }
    const target = event.target
    if (!(target instanceof Element)) return
    const nodeElement = target.closest<HTMLElement>("[data-node-id]")
    if (nodeElement === null) return
    const id = nodeElement.dataset.nodeId
    if (id === undefined) return
    const record = currentStore.get(id)
    if (record?.typeName !== "node" || record.nodeType !== "rectangle") return
    startPointerInteraction(event, record, nodeElement, target, "move")
  }
  const startWorkspacePan = (event: PointerEvent): void => {
    if (isPreviewActive()) return
    activeInteraction?.cancel()
    event.preventDefault()
    event.stopPropagation()
    workspace.dataset.panActive = "true"
    shell.dataset.panActive = "true"
    const start = { x: event.clientX, y: event.clientY }
    const viewport = sessionState.viewport
    let ended = false
    const cancel = (): void => {
      if (ended) return
      ended = true
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
      delete workspace.dataset.panActive
      delete shell.dataset.panActive
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
    if (isPreviewActive()) return
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
    if (isPreviewActive() || event.defaultPrevented || shell.dataset.mode !== "stage-edit") return
    if (sessionState.interactionMode === "pan") {
      startWorkspacePan(event)
      return
    }
    if (spacePressed || event.pointerType === "touch" || event.button === 1) {
      startWorkspacePan(event)
      return
    }
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest("[data-node-id]")) return
    startMarqueeSelection(event)
  }
  const onWorkspaceWheel = (event: WheelEvent): void => {
    if (isPreviewActive() || shell.dataset.mode !== "stage-edit") return
    event.preventDefault()
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
  const onWindowKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== " " && event.code !== "Space") return
    spacePressed = false
    delete shell.dataset.panning
  }
  const onWindowBlur = (): void => {
    spacePressed = false
    delete shell.dataset.panning
  }
  board.addEventListener("pointerdown", onBoardPointerDown)
  overlay.addEventListener("pointerdown", onOverlayPointerDown)
  workspace.addEventListener("pointerdown", onWorkspacePointerDown)
  workspace.addEventListener("wheel", onWorkspaceWheel, { passive: false })
  shell.addEventListener("keydown", onShellKeyDown)
  window.addEventListener("keydown", onWindowKeyDown)
  window.addEventListener("keyup", onWindowKeyUp)
  window.addEventListener("blur", onWindowBlur)

  const onCoreChange = (event: EditorChangeEvent): void => {
    if (destroyed) return
    sourceStore = event.store
    if (isPreviewActive()) return
    activeInteraction?.cancel()
    currentStore = sourceStore
    const page = currentStore.get(options.pageId)
    if (page?.typeName !== "page") return
    canvas.update(currentStore, page, canvasNeedsRebuild(event.transaction.forward))
    if (treeMounted !== undefined && treeNeedsUpdate(event.transaction.forward)) {
      treeMounted.update(currentStore, options.pageId, sessionState, true)
    }
    renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
  }
  const onSessionChange = (nextState: EditorSessionState): void => {
    if (destroyed) return
    sourceSessionState = nextState
    if (isPreviewActive()) return
    const selectionChanged = !sameArray(sessionState.selection, nextState.selection)
    const viewportChanged =
      sessionState.viewport.x !== nextState.viewport.x ||
      sessionState.viewport.y !== nextState.viewport.y ||
      sessionState.viewport.zoom !== nextState.viewport.zoom
    const gridChanged = sessionState.gridVisible !== nextState.gridVisible
    const expandedChanged = !sameArray(sessionState.expanded, nextState.expanded)
    if (groupResizeActive && (selectionChanged || viewportChanged)) activeInteraction?.cancel()
    sessionState = nextState
    if (treeMounted !== undefined) {
      if (expandedChanged) treeMounted.update(currentStore, options.pageId, nextState, true)
      else if (selectionChanged) treeMounted.update(currentStore, options.pageId, nextState, false)
    }
    if (viewportChanged || gridChanged) updateViewport()
    if (selectionChanged || viewportChanged) {
      renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, nextState)
    }
  }

  const unsubscribeCore = coreEditor.subscribe(onCoreChange)
  const unsubscribeSession = session.subscribe(onSessionChange)
  const unsubscribePreview = options.preview?.subscribe((nextFrame) => {
    if (destroyed) return
    activeInteraction?.cancel()
    previewFrame = nextFrame
    sessionState = previewFrame.active
      ? (previewFrame.session ?? sourceSessionState)
      : sourceSessionState
    currentStore = previewFrame.active ? (previewStore(previewFrame) ?? sourceStore) : sourceStore
    const page = currentStore.get(options.pageId)
    if (page?.typeName !== "page") return
    canvas.update(currentStore, page, true)
    treeMounted?.update(
      currentStore,
      options.pageId,
      previewFrame.active ? treeSessionState(sessionState) : sourceSessionState,
      true,
    )
    updateViewport()
    renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
    updateReplayBanner()
  })

  return {
    session,
    destroy() {
      if (destroyed) return
      destroyed = true
      activeInteraction?.cancel()
      board.removeEventListener("pointerdown", onBoardPointerDown)
      overlay.removeEventListener("pointerdown", onOverlayPointerDown)
      workspace.removeEventListener("pointerdown", onWorkspacePointerDown)
      workspace.removeEventListener("wheel", onWorkspaceWheel)
      shell.removeEventListener("keydown", onShellKeyDown)
      window.removeEventListener("keydown", onWindowKeyDown)
      window.removeEventListener("keyup", onWindowKeyUp)
      window.removeEventListener("blur", onWindowBlur)
      treeMounted?.destroy()
      unsubscribeCore()
      unsubscribeSession()
      unsubscribePreview?.()
      shell.remove()
    },
  }
}
