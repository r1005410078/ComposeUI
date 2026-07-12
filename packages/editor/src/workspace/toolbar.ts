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
import type { EditorSession } from "../session"
import type { EditorWorkspaceApi } from "./editor-workspace"
import type { WorkspacePanelDescriptor } from "./types"

export interface WorkspaceToolbarOptions {
  editor: Editor
  session: EditorSession
  api: Pick<EditorWorkspaceApi, "undo" | "redo" | "openPanel">
  panels: readonly WorkspacePanelDescriptor[]
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

export function mountWorkspaceToolbar(
  root: HTMLElement,
  options: WorkspaceToolbarOptions,
): () => void {
  root.className = "composeui-editor__toolbar"
  root.setAttribute("aria-label", "工作区工具")

  const tools = document.createElement("div")
  tools.className = "composeui-editor__toolbar-group"
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
  tools.append(select, pan, move, rotate, scale, snap, lock, view, grid, undo, redo)

  root.replaceChildren(tools)

  const render = (): void => {
    const state = options.session.getState()
    setPressed(select, state.interactionMode === "select")
    setPressed(pan, state.interactionMode === "pan")
    setPressed(grid, state.gridVisible)
    undo.disabled = !options.editor.canUndo()
    redo.disabled = !options.editor.canRedo()
  }
  const chooseTool = (tool: ToolId): void => {
    options.session.setInteractionMode(tool)
  }
  select.addEventListener("click", () => chooseTool("select"))
  pan.addEventListener("click", () => chooseTool("pan"))
  grid.addEventListener("click", () => {
    options.session.setGridVisible(!options.session.getState().gridVisible)
  })
  undo.addEventListener("click", () => options.api.undo())
  redo.addEventListener("click", () => options.api.redo())

  const unsubscribeSession = options.session.subscribe(render)
  const unsubscribeEditor = options.editor.subscribe(render)
  render()

  return () => {
    unsubscribeSession()
    unsubscribeEditor()
    root.replaceChildren()
  }
}
