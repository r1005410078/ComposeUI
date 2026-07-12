import type { Editor, NodeRecord, PageRecord, RecordStore } from "@composeui/core"
import type { EditorChangeEvent, TransactionPatch } from "@composeui/core"
import { safeColor } from "./colors"
import { worldToScreen } from "./coordinates"
import { createComponentTree } from "./component-tree"
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
): HTMLElement | undefined {
  if (!node.visible) return undefined

  const element = createNodeElement(node)
  nodeElements.set(node.id, element)
  const worldX = parentWorldX + node.layout.x
  const worldY = parentWorldY + node.layout.y
  visibleNodes.set(node.id, { node, worldX, worldY })
  for (const child of children.get(node.id) ?? []) {
    const childElement = renderNode(child, children, visibleNodes, nodeElements, worldX, worldY)
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
): void {
  if (!node.visible) return
  const worldX = parentWorldX + node.layout.x
  const worldY = parentWorldY + node.layout.y
  visibleNodes.set(node.id, { node, worldX, worldY })
  const element = nodeElements.get(node.id)
  if (element !== undefined) applyNodeStyle(element, node)
  for (const child of children.get(node.id) ?? []) {
    collectVisibleNodes(child, children, visibleNodes, nodeElements, worldX, worldY)
  }
}

function renderSelectionOverlay(
  overlay: SVGSVGElement,
  visibleNodes: ReadonlyMap<string, VisibleNode>,
  state: EditorSessionState,
): void {
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
    rect.setAttribute("x", String(origin.x))
    rect.setAttribute("y", String(origin.y))
    rect.setAttribute("width", String(end.x - origin.x))
    rect.setAttribute("height", String(end.y - origin.y))
    fragment.append(rect)
  }
  overlay.replaceChildren(fragment)
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
          )
          if (element !== undefined) fragment.append(element)
        }
        board.replaceChildren(fragment)
        return
      }

      canvas.visibleNodes.clear()
      for (const node of canvas.children.get(nextPage.id) ?? []) {
        collectVisibleNodes(node, canvas.children, canvas.visibleNodes, canvas.nodeElements, 0, 0)
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

  const tree = createComponentTree(coreEditor.getStore(), options.pageId, sessionState, session)
  aside.append(tree.element)
  world.append(board)
  workspace.append(world, overlay)
  shell.append(aside, workspace)
  root.replaceChildren(shell)

  let currentStore = coreEditor.getStore()
  const canvas = createCanvasView(currentStore, initialPage, world, board, overlay)
  const updateViewport = (): void => {
    world.style.transform = `translate(${sessionState.viewport.x}px, ${sessionState.viewport.y}px) scale(${sessionState.viewport.zoom})`
  }
  updateViewport()
  renderSelectionOverlay(overlay, canvas.visibleNodes, sessionState)

  let destroyed = false
  const onCoreChange = (event: EditorChangeEvent): void => {
    if (destroyed) return
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
    sessionState = nextState
    if (expandedChanged) tree.update(currentStore, options.pageId, nextState, true)
    else if (selectionChanged) tree.update(currentStore, options.pageId, nextState, false)
    if (viewportChanged) updateViewport()
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
      unsubscribeCore()
      unsubscribeSession()
      shell.remove()
    },
  }
}
