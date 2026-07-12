import type { EditorRecord } from "@composeui/core"
import { mountComponentTree } from "../component-tree"
import { mountEditor } from "../editor-view"
import type { WorkspaceContext, WorkspacePanelDescriptor, WorkspacePanelMount } from "./types"

const PANEL_META: Record<
  string,
  Pick<WorkspacePanelDescriptor, "title" | "closable" | "defaultPosition">
> = {
  scene: { title: "Scene", closable: false, defaultPosition: "left" },
  resources: { title: "Resources", closable: true, defaultPosition: "left" },
  history: { title: "History", closable: true, defaultPosition: "left" },
  canvas: { title: "Canvas", closable: false, defaultPosition: "center" },
  inspector: { title: "Inspector", closable: true, defaultPosition: "right" },
  signals: { title: "Signals", closable: true, defaultPosition: "right" },
  output: { title: "Output", closable: true, defaultPosition: "bottom" },
  debugger: { title: "Debugger", closable: true, defaultPosition: "bottom" },
  animation: { title: "Animation", closable: true, defaultPosition: "bottom" },
  "shader-editor": { title: "Shader Editor", closable: true, defaultPosition: "bottom" },
}

function descriptor(id: string, mount: WorkspacePanelMount): WorkspacePanelDescriptor {
  const meta = PANEL_META[id]
  if (meta === undefined) throw new Error(`Unknown workspace panel: ${id}`)
  return { id, ...meta, mount }
}

function emptyPanel(
  id: string,
  title: string,
  message = `No ${title.toLowerCase()} available.`,
): WorkspacePanelMount {
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

export function createScenePanel(): WorkspacePanelDescriptor {
  return descriptor("scene", (root, context) => {
    const mounted = mountComponentTree(root, context.editor, {
      pageId: context.pageId,
      session: context.session,
    })
    return () => mounted.destroy()
  })
}

export function createCanvasPanel(): WorkspacePanelDescriptor {
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
  if (record === undefined) return { name: "Nothing selected", type: "None" }
  return {
    name: "name" in record ? record.name : record.id,
    type: record.typeName,
  }
}

export function createInspectorPanel(): WorkspacePanelDescriptor {
  return descriptor("inspector", (root, context) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__inspector"
    panel.setAttribute("aria-label", "Inspector")
    root.replaceChildren(panel)

    const render = (): void => {
      const selectedId = context.session.getState().selection[0]
      const selected = selectedId === undefined ? undefined : context.editor.getRecord(selectedId)
      const label = recordLabel(selected)
      panel.replaceChildren()
      const heading = document.createElement("h2")
      heading.textContent = "Inspector"
      const name = document.createElement("p")
      name.dataset.testid = "inspector-name"
      name.textContent = label.name
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

export function createResourcesPanel(): WorkspacePanelDescriptor {
  return descriptor("resources", (root, context) => {
    const panel = document.createElement("section")
    panel.className = "composeui-editor__resources"
    panel.setAttribute("aria-label", "Resources")
    const heading = document.createElement("h2")
    heading.textContent = "Resources"
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
        empty.textContent = "No resources available."
        panel.append(empty)
        return
      }
      const list = document.createElement("ul")
      list.dataset.testid = "resource-list"
      for (const item of items) {
        const entry = document.createElement("li")
        if (typeof item === "object" && item !== null) {
          const value = item as { name?: unknown; id?: unknown }
          entry.textContent = String(value.name ?? value.id ?? "Resource")
        } else {
          entry.textContent = String(item)
        }
        list.append(entry)
      }
      panel.append(list)
    }

    if (context.resources === undefined) {
      render([])
    } else {
      Promise.resolve(context.resources.list()).then(render, () => render([]))
    }
    return () => {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    }
  })
}

export function createUtilityPanel(
  id: "history" | "signals" | "output" | "debugger" | "animation" | "shader-editor",
): WorkspacePanelDescriptor {
  const meta = PANEL_META[id]
  if (meta === undefined) throw new Error(`Unknown workspace panel: ${id}`)
  return descriptor(id, emptyPanel(id, meta.title))
}

export function createWorkspacePanels(): WorkspacePanelDescriptor[] {
  return [
    createScenePanel(),
    createResourcesPanel(),
    createUtilityPanel("history"),
    createCanvasPanel(),
    createInspectorPanel(),
    createUtilityPanel("signals"),
    createUtilityPanel("output"),
    createUtilityPanel("debugger"),
    createUtilityPanel("animation"),
    createUtilityPanel("shader-editor"),
  ]
}

export const createFirstPartyPanels = createWorkspacePanels
