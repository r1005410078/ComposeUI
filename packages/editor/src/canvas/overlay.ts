/**
 * @module overlay
 *
 * SVG 选中叠层：单选轮廓、多选框、八向手柄；框选矩形由 pointer 挂到同一 SVG。
 *
 * 边界：不写 Document；几何读 free layout + session viewport。
 * 数据流：session/selection 变化 → renderSelectionOverlay；拖拽中 setSelectionOutlinePreview。
 */

import type { RecordStore } from "@composeui/core"
import { worldToScreen } from "../session/coordinates"
import type { EditorSessionState } from "../session/session"
import { isTransformLocked, type VisibleNode } from "./board-render"
import { selectionBounds } from "./group-resize"
import type { GroupResizeHandle, GroupResizeItem } from "./group-resize"

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

export const GROUP_RESIZE_HANDLES: readonly GroupResizeHandle[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
]

export interface GroupSelectionPreview {
  items: GroupResizeItem[]
  bounds: ReturnType<typeof selectionBounds>
  parentWorldX: number
  parentWorldY: number
}

export function getGroupSelection(
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

export function renderSelectionOverlay(
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

/** 移动预览时把选框/手柄整体平移；undefined 清除 transform。 */
export function setSelectionOutlinePreview(
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
