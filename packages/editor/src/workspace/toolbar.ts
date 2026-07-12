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
  root.setAttribute("aria-label", "Workspace tools")

  const tools = document.createElement("div")
  tools.className = "composeui-editor__toolbar-group"
  const select = iconButton("select", "Select tool", MousePointer2)
  const pan = iconButton("pan", "Pan tool", Hand)
  const grid = iconButton("grid", "Toggle grid", Grid3X3)
  const undo = iconButton("undo", "Undo", Undo2)
  const redo = iconButton("redo", "Redo", Redo2)
  const move = iconButton("move", "Move tool", Move)
  const rotate = iconButton("rotate", "Rotate tool", RotateCw)
  const scale = iconButton("scale", "Scale tool", Scale)
  const snap = iconButton("snap", "Snap to grid", Magnet)
  const lock = iconButton("lock", "Lock selection", Lock)
  const view = iconButton("view", "View options", Eye)
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
