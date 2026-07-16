/**
 * @module workspace/toolbar
 *
 * 工作区顶栏：选择/平移模式、网格、undo/redo 等。
 * 文档命令代理 Editor；交互模式写 Session；预览激活时可禁用编辑控件。
 */

import {
  Eye,
  Grid3X3,
  Hand,
  Lock,
  Magnet,
  MousePointer2,
  Move,
  Redo2,
  RotateCw,
  Scale,
  Undo2,
  createElement,
} from "lucide"
import type { Editor } from "@composeui/core"
import type { EditorPreviewSource } from "../canvas/editor-view"
import type { EditorSession } from "../session/session"
import type { EditorWorkspaceApi } from "./editor-workspace"
import type { WorkspacePanelDescriptor } from "./types"

export interface WorkspaceToolbarOptions {
  editor: Editor
  session: EditorSession
  api: Pick<EditorWorkspaceApi, "undo" | "redo" | "openPanel">
  panels: readonly WorkspacePanelDescriptor[]
  preview?: EditorPreviewSource
}

type ToolId = "select" | "pan"

function iconButton(
  id: string,
  label: string,
  icon: Parameters<typeof createElement>[0],
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "composeui-editor__toolbar-button"
  button.dataset.testid = `workspace-tool-${id}`
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createElement(icon))
  return button
}

function setPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute("aria-pressed", String(pressed))
}

function toolbarDivider(): HTMLSpanElement {
  const divider = document.createElement("span")
  divider.className = "composeui-editor__toolbar-divider"
  divider.dataset.testid = "workspace-toolbar-divider"
  divider.setAttribute("aria-hidden", "true")
  return divider
}

function toolbarGroup(...buttons: HTMLButtonElement[]): HTMLDivElement {
  const group = document.createElement("div")
  group.className = "composeui-editor__toolbar-group"
  group.append(...buttons)
  return group
}

/** 挂载工作区工具条；返回的 destroy 移除 DOM 与订阅。 */
export function mountWorkspaceToolbar(
  root: HTMLElement,
  options: WorkspaceToolbarOptions,
): () => void {
  root.className = "composeui-editor__toolbar"
  root.setAttribute("aria-label", "工作区工具")

  const select = iconButton("select", "选择工具", MousePointer2)
  const pan = iconButton("pan", "平移工具", Hand)
  const grid = iconButton("grid", "切换网格", Grid3X3)
  const undo = iconButton("undo", "撤销", Undo2)
  const redo = iconButton("redo", "重做", Redo2)
  const move = iconButton("move", "移动工具", Move)
  const rotate = iconButton("rotate", "旋转工具", RotateCw)
  const scale = iconButton("scale", "缩放工具", Scale)
  const snap = iconButton("snap", "吸附到网格", Magnet)
  const lock = iconButton("lock", "锁定选中项", Lock)
  const view = iconButton("view", "视图选项", Eye)
  for (const button of [move, rotate, scale, snap, lock, view]) button.disabled = true
  root.replaceChildren(
    toolbarGroup(select, pan),
    toolbarDivider(),
    toolbarGroup(move, rotate, scale),
    toolbarDivider(),
    toolbarGroup(snap, lock, view),
    toolbarDivider(),
    toolbarGroup(grid),
    toolbarDivider(),
    toolbarGroup(undo, redo),
  )

  let readOnly = options.preview?.getState().active ?? false

  const render = (): void => {
    const state = options.session.getState()
    setPressed(select, state.interactionMode === "select")
    setPressed(pan, state.interactionMode === "pan")
    setPressed(grid, state.gridVisible)
    select.disabled = readOnly
    pan.disabled = readOnly
    grid.disabled = readOnly
    undo.disabled = readOnly || !options.editor.canUndo()
    redo.disabled = readOnly || !options.editor.canRedo()
  }
  const chooseTool = (tool: ToolId): void => {
    if (readOnly) return
    options.session.setInteractionMode(tool)
  }
  select.addEventListener("click", () => chooseTool("select"))
  pan.addEventListener("click", () => chooseTool("pan"))
  grid.addEventListener("click", () => {
    if (readOnly) return
    options.session.setGridVisible(!options.session.getState().gridVisible)
  })
  undo.addEventListener("click", () => {
    if (readOnly) return
    options.api.undo()
  })
  redo.addEventListener("click", () => {
    if (readOnly) return
    options.api.redo()
  })

  const unsubscribeSession = options.session.subscribe(render)
  const unsubscribeEditor = options.editor.subscribe(render)
  const unsubscribePreview = options.preview?.subscribe((frame) => {
    readOnly = frame.active
    render()
  })
  render()

  return () => {
    unsubscribeSession()
    unsubscribeEditor()
    unsubscribePreview?.()
    root.replaceChildren()
  }
}
