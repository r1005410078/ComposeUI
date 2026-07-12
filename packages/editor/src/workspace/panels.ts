import type { EditorRecord, HistoryEntry } from "@composeui/core"
import { Redo2, Undo2, createElement as createIconElement } from "lucide"
import { mountComponentTree } from "../component-tree"
import { mountEditor } from "../editor-view"
import type { WorkspacePanelDescriptor, WorkspacePanelMount } from "./types"

export type PanelId =
  | "scene"
  | "resources"
  | "history"
  | "canvas"
  | "inspector"
  | "signals"
  | "output"

export type FirstPartyPanelDescriptor = Omit<WorkspacePanelDescriptor, "id"> & { id: PanelId }

const PANEL_META: Record<
  PanelId,
  Pick<WorkspacePanelDescriptor, "title" | "closable" | "defaultPosition">
> = {
  scene: { title: "场景", closable: true, defaultPosition: "left" },
  resources: { title: "资源", closable: true, defaultPosition: "left" },
  history: { title: "历史", closable: true, defaultPosition: "left" },
  canvas: { title: "画布", closable: false, defaultPosition: "center" },
  inspector: { title: "检查器", closable: true, defaultPosition: "right" },
  signals: { title: "信号", closable: true, defaultPosition: "right" },
  output: { title: "输出", closable: true, defaultPosition: "bottom" },
}

function descriptor(id: PanelId, mount: WorkspacePanelMount): FirstPartyPanelDescriptor {
  const meta = PANEL_META[id]
  if (meta === undefined) throw new Error(`Unknown workspace panel: ${id}`)
  return { id, ...meta, mount }
}

function panelIconButton(
  testId: string,
  label: string,
  iconNode: Parameters<typeof createIconElement>[0],
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.dataset.testid = testId
  button.title = label
  button.setAttribute("aria-label", label)
  const icon = createIconElement(iconNode)
  icon.setAttribute("aria-hidden", "true")
  icon.setAttribute("focusable", "false")
  button.append(icon)
  return button
}

function emptyPanel(id: string, title: string, message = `暂无${title}。`): WorkspacePanelMount {
  return (root) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__empty-panel"
    panel.setAttribute("aria-label", title)
    const heading = document.createElement("h2")
    heading.textContent = title
    const empty = document.createElement("p")
    empty.dataset.testid = `empty-${id}`
    empty.textContent = message
    panel.append(heading, empty)
    root.replaceChildren(panel)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    }
  }
}

export function createScenePanel(): FirstPartyPanelDescriptor {
  return descriptor("scene", (root, context) => {
    const mounted = mountComponentTree(root, context.editor, {
      pageId: context.pageId,
      session: context.session,
    })
    return () => mounted.destroy()
  })
}

export function createCanvasPanel(): FirstPartyPanelDescriptor {
  return descriptor("canvas", (root, context) => {
    const mounted = mountEditor(root, context.editor, {
      pageId: context.pageId,
      session: context.session,
      view: "canvas",
    })
    return () => mounted.destroy()
  })
}

function recordLabel(record: EditorRecord | undefined): { name: string; type: string } {
  if (record === undefined) return { name: "未选择", type: "无" }
  return {
    name: "name" in record ? record.name : record.id,
    type: record.typeName,
  }
}

export function createInspectorPanel(): FirstPartyPanelDescriptor {
  return descriptor("inspector", (root, context) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__inspector"
    panel.setAttribute("aria-label", "检查器")
    root.replaceChildren(panel)

    const render = (): void => {
      const selectedId = context.session.getState().selection[0]
      const selected = selectedId === undefined ? undefined : context.editor.getRecord(selectedId)
      const label = recordLabel(selected)
      panel.replaceChildren()
      const heading = document.createElement("h2")
      heading.textContent = "检查器"
      const name = document.createElement("input")
      name.type = "text"
      name.dataset.testid = "inspector-name"
      name.setAttribute("aria-label", "节点名称")
      name.value = label.name
      name.disabled = selected === undefined || selected.typeName !== "node"
      const commitName = (): void => {
        const value = name.value.trim()
        if (selected?.typeName !== "node" || value.length === 0 || value === label.name) {
          name.value = label.name
          return
        }
        context.editor.dispatch({ id: "node.rename", payload: { id: selected.id, name: value } })
      }
      name.addEventListener("change", commitName)
      name.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return
        event.preventDefault()
        commitName()
      })
      name.addEventListener("blur", commitName)
      const type = document.createElement("p")
      type.dataset.testid = "inspector-type"
      type.textContent = label.type
      panel.append(heading, name, type)
    }
    render()

    const unsubscribeSession = context.session.subscribe(render)
    const unsubscribeEditor = context.editor.subscribe(render)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      unsubscribeSession()
      unsubscribeEditor()
      root.replaceChildren()
    }
  })
}

export function createHistoryPanel(): FirstPartyPanelDescriptor {
  return descriptor("history", (root, context) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__history"
    panel.setAttribute("aria-label", "历史")
    root.replaceChildren(panel)

    const render = (): void => {
      const history = context.editor.getHistory()
      const actions = document.createElement("div")
      actions.className = "composeui-editor__history-toolbar"
      actions.dataset.testid = "history-toolbar"
      const undo = panelIconButton("history-undo", "撤销历史记录", Undo2)
      undo.disabled = history.past.length === 0
      undo.addEventListener("click", () => context.editor.undo())
      const redo = panelIconButton("history-redo", "重做历史记录", Redo2)
      redo.disabled = history.future.length === 0
      redo.addEventListener("click", () => context.editor.redo())
      actions.append(undo, redo)

      const list = document.createElement("ol")
      list.className = "composeui-editor__history-list"
      list.dataset.testid = "history-list"
      const entries = history.entries.reduceRight<Array<{ entry: HistoryEntry; index: number }>>(
        (reversed, entry, index) => {
          reversed.push({ entry, index })
          return reversed
        },
        [],
      )
      for (const { entry, index } of entries) {
        const item = document.createElement("li")
        item.dataset.testid = "history-entry"
        item.dataset.current = String(index === history.currentIndex - 1)
        item.dataset.future = String(index >= history.currentIndex)
        item.setAttribute("role", "button")
        item.tabIndex = 0
        item.title = entry.label
        item.setAttribute(
          "aria-label",
          entry.label + (index === history.currentIndex - 1 ? "，当前" : "，跳转"),
        )
        const jump = (): void => {
          context.editor.jumpToHistory(index + 1)
        }
        item.addEventListener("click", jump)
        item.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          jump()
        })
        const sequence = document.createElement("span")
        sequence.className = "composeui-editor__history-sequence"
        sequence.textContent = String(index + 1)
        const label = document.createElement("span")
        label.className = "composeui-editor__history-label"
        label.textContent = entry.label
        item.append(sequence, label)
        list.append(item)
      }
      panel.replaceChildren(actions, list)
    }
    render()
    const unsubscribe = context.editor.subscribe(render)
    return () => {
      unsubscribe()
      root.replaceChildren()
    }
  })
}

function createOutputPanel(): FirstPartyPanelDescriptor {
  return descriptor("output", (root) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__output"
    panel.setAttribute("aria-label", "输出")
    const messages = document.createElement("div")
    messages.className = "composeui-editor__output-messages"
    messages.dataset.testid = "output-messages"
    const empty = document.createElement("p")
    empty.dataset.testid = "empty-output"
    empty.textContent = "暂无输出。"
    messages.append(empty)
    panel.append(messages)
    root.replaceChildren(panel)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    }
  })
}

export function createResourcesPanel(): FirstPartyPanelDescriptor {
  return descriptor("resources", (root, context) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__resources"
    panel.setAttribute("aria-label", "资源")
    const heading = document.createElement("h2")
    heading.textContent = "资源"
    panel.append(heading)
    root.replaceChildren(panel)
    let disposed = false

    const render = (items: readonly unknown[]): void => {
      if (disposed) return
      panel
        .querySelector("[data-testid='empty-resources'], [data-testid='resource-list']")
        ?.remove()
      if (items.length === 0) {
        const empty = document.createElement("p")
        empty.dataset.testid = "empty-resources"
        empty.textContent = "暂无资源。"
        panel.append(empty)
        return
      }
      const list = document.createElement("ul")
      list.dataset.testid = "resource-list"
      for (const item of items) {
        const entry = document.createElement("li")
        if (typeof item === "object" && item !== null) {
          const value = item as { name?: unknown; id?: unknown }
          entry.textContent = String(value.name ?? value.id ?? "资源")
        } else {
          entry.textContent = String(item)
        }
        list.append(entry)
      }
      panel.append(list)
    }

    const renderError = (): void => {
      if (disposed) return
      panel
        .querySelector(
          "[data-testid='empty-resources'], [data-testid='resource-list'], [data-testid='resource-error']",
        )
        ?.remove()
      const error = document.createElement("p")
      error.dataset.testid = "resource-error"
      error.textContent = "无法加载资源。"
      panel.append(error)
    }

    const handleFailure = (error: unknown): void => {
      if (disposed) return
      context.emit({ type: "panel-failure", panelId: "resources", error })
      renderError()
    }

    if (context.resources === undefined) {
      render([])
    } else {
      try {
        Promise.resolve(context.resources.list()).then(render, handleFailure)
      } catch (error) {
        handleFailure(error)
      }
    }
    return () => {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    }
  })
}

export function createUtilityPanel(
  id: Exclude<PanelId, "scene" | "resources" | "canvas" | "inspector">,
): FirstPartyPanelDescriptor {
  const meta = PANEL_META[id]
  if (meta === undefined) throw new Error(`Unknown workspace panel: ${id}`)
  return descriptor(id, emptyPanel(id, meta.title))
}

export function createWorkspacePanels(): FirstPartyPanelDescriptor[] {
  return [
    createScenePanel(),
    createResourcesPanel(),
    createHistoryPanel(),
    createCanvasPanel(),
    createInspectorPanel(),
    createUtilityPanel("signals"),
    createOutputPanel(),
  ]
}

export const createFirstPartyPanels = createWorkspacePanels
