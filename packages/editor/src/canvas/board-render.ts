/**
 * @module board-render
 *
 * page board 与节点 Light DOM 同步：从 RecordStore 重建/增量更新节点树。
 *
 * 边界：
 * - 只读 store 与写 DOM；不写 Session、不 dispatch
 * - 当前仍从 free layout 记录读几何，不做 LayoutProjection 切换
 *
 * 数据流：mount 订阅 → createCanvasView.update → board/node DOM
 */

import type { NodeRecord, PageRecord, RecordStore, TransactionPatch } from "@composeui/core"
import { safeColor } from "./colors"

const DEFAULT_PAGE_BACKGROUND = "#ffffff"
const SAFE_PAGE_BACKGROUND = "#ffffff"
const SAFE_NODE_FILL = "#2563eb"

export interface VisibleNode {
  node: NodeRecord
  worldX: number
  worldY: number
}

export interface CanvasView {
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

/** 节点定位使用 parent-local；fill 经 safeColor 防 CSS 注入。 */
export function applyNodeStyle(element: HTMLElement, node: NodeRecord): void {
  Object.assign(element.style, {
    position: "absolute",
    left: `${node.layout.x}px`,
    top: `${node.layout.y}px`,
    width: `${node.layout.width}px`,
    height: `${node.layout.height}px`,
    background: safeColor(node.props.fill, SAFE_NODE_FILL),
  })
}

/** 默认白底走 CSS 变量空串，便于主题；其它颜色仍 sanitize。 */
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

/** 祖先链任一 locked 则变换锁定（与 group/move 策略一致）。 */
export function isTransformLocked(store: RecordStore, node: NodeRecord): boolean {
  let current: NodeRecord | undefined = node
  while (current !== undefined) {
    if (current.locked) return true
    const parent = store.get(current.parentId)
    current = parent?.typeName === "node" ? parent : undefined
  }
  return false
}

/**
 * 创建 board 渲染器：初次全量挂载节点 DOM，后续按 rebuild 选择全量或样式/世界坐标增量。
 */
export function createCanvasView(
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

/** 结构变化（创建/删除/父子/index/visible）需要重建 DOM；纯几何可增量。 */
export function canvasNeedsRebuild(patch: TransactionPatch): boolean {
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
