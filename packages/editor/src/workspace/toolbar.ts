import { Hand, LayoutPanelTop, MousePointer2, Redo2, Undo2, Grid3X3, createElement } from "lucide"
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
  tools.append(select, pan, grid, undo, redo)

  const panels = document.createElement("div")
  panels.className = "composeui-editor__toolbar-group composeui-editor__toolbar-panels"
  const panelMenuButton = iconButton("panel-menu", "Open panels", LayoutPanelTop)
  panelMenuButton.dataset.testid = "workspace-panel-menu"
  const panelMenu = document.createElement("div")
  panelMenu.className = "composeui-editor__panel-menu"
  panelMenu.hidden = true
  panelMenu.setAttribute("role", "menu")
  for (const panel of options.panels) {
    if (!panel.closable) continue
    const item = document.createElement("button")
    item.type = "button"
    item.className = "composeui-editor__panel-menu-item"
    item.dataset.panelId = panel.id
    item.setAttribute("role", "menuitem")
    item.textContent = panel.title
    item.addEventListener("click", () => {
      options.api.openPanel(panel.id)
      panelMenu.hidden = true
    })
    panelMenu.append(item)
  }
  panelMenuButton.addEventListener("click", () => {
    panelMenu.hidden = !panelMenu.hidden
  })
  panels.append(panelMenuButton, panelMenu)
  root.replaceChildren(tools, panels)

  let activeTool: ToolId = "select"
  const render = (): void => {
    const state = options.session.getState()
    setPressed(select, activeTool === "select")
    setPressed(pan, activeTool === "pan")
    setPressed(grid, state.gridVisible)
    undo.disabled = !options.editor.canUndo()
    redo.disabled = !options.editor.canRedo()
  }
  const chooseTool = (tool: ToolId): void => {
    activeTool = tool
    render()
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
