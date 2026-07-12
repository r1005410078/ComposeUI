import type { Editor, NodeRecord, PageRecord, RecordStore } from "@composeui/core"
import { worldToScreen } from "./coordinates"
import { renderComponentTree } from "./component-tree"
import { EditorSession } from "./session"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

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

function renderNode(
  node: NodeRecord,
  children: ReadonlyMap<string, readonly NodeRecord[]>,
  visibleNodes: Map<string, VisibleNode>,
  parentWorldX: number,
  parentWorldY: number,
): HTMLElement | undefined {
  if (!node.visible) return undefined

  const element = document.createElement("div")
  element.className = "composeui-editor__node"
  element.dataset.nodeId = node.id
  Object.assign(element.style, {
    position: "absolute",
    left: `${node.layout.x}px`,
    top: `${node.layout.y}px`,
    width: `${node.layout.width}px`,
    height: `${node.layout.height}px`,
    background: node.props.fill,
  })

  const worldX = parentWorldX + node.layout.x
  const worldY = parentWorldY + node.layout.y
  visibleNodes.set(node.id, { node, worldX, worldY })
  for (const child of children.get(node.id) ?? []) {
    const childElement = renderNode(child, children, visibleNodes, worldX, worldY)
    if (childElement !== undefined) element.append(childElement)
  }
  return element
}

function renderPageBoard(
  page: PageRecord,
  children: ReadonlyMap<string, readonly NodeRecord[]>,
  visibleNodes: Map<string, VisibleNode>,
): HTMLElement {
  const board = document.createElement("section")
  board.className = "composeui-editor__page-board"
  board.dataset.testid = "page-board"
  board.setAttribute("aria-label", "Page board")
  Object.assign(board.style, {
    width: `${page.width}px`,
    height: `${page.height}px`,
    background: page.background,
    overflow: page.overflow,
  })

  for (const node of children.get(page.id) ?? []) {
    const element = renderNode(node, children, visibleNodes, 0, 0)
    if (element !== undefined) board.append(element)
  }
  return board
}

function renderSelectionOverlay(
  visibleNodes: ReadonlyMap<string, VisibleNode>,
  session: EditorSession,
): SVGSVGElement {
  const overlay = document.createElementNS(SVG_NAMESPACE, "svg")
  overlay.classList.add("composeui-editor__selection-overlay")
  overlay.dataset.testid = "selection-overlay"
  overlay.setAttribute("aria-label", "Selection overlay")

  const { selection, viewport } = session.getState()
  for (const id of selection) {
    const selected = visibleNodes.get(id)
    if (selected === undefined) continue
    const origin = worldToScreen({ x: selected.worldX, y: selected.worldY }, viewport)
    const end = worldToScreen(
      {
        x: selected.worldX + selected.node.layout.width,
        y: selected.worldY + selected.node.layout.height,
      },
      viewport,
    )
    const rect = document.createElementNS(SVG_NAMESPACE, "rect")
    rect.dataset.testid = `selection-${id}`
    rect.setAttribute("x", String(origin.x))
    rect.setAttribute("y", String(origin.y))
    rect.setAttribute("width", String(end.x - origin.x))
    rect.setAttribute("height", String(end.y - origin.y))
    overlay.append(rect)
  }
  return overlay
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

  const shell = document.createElement("section")
  shell.className = "composeui-editor"
  shell.dataset.testid = "editor-shell"
  root.replaceChildren(shell)

  let destroyed = false
  const render = (): void => {
    if (destroyed) return
    const store = coreEditor.getStore()
    const page = store.get(options.pageId)
    if (page?.typeName !== "page") return

    const aside = document.createElement("aside")
    aside.className = "composeui-editor__component-tree"
    aside.setAttribute("aria-label", "Component tree")
    aside.append(renderComponentTree(store, options.pageId, session))

    const workspace = document.createElement("main")
    workspace.className = "composeui-editor__workspace"
    workspace.dataset.testid = "workspace"
    workspace.setAttribute("aria-label", "Workspace")

    const world = document.createElement("div")
    const { viewport } = session.getState()
    world.className = "composeui-editor__world"
    world.dataset.testid = "world"
    world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`

    const visibleNodes = new Map<string, VisibleNode>()
    world.append(renderPageBoard(page, indexChildren(store), visibleNodes))
    workspace.append(world, renderSelectionOverlay(visibleNodes, session))
    shell.replaceChildren(aside, workspace)
  }

  const unsubscribeCore = coreEditor.subscribe(render)
  const unsubscribeSession = session.subscribe(render)
  render()

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
