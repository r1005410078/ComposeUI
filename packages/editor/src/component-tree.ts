import { getTreeItems } from "@composeui/core"
import type { RecordStore, TreeItem } from "@composeui/core"
import type { EditorSession } from "./session"

function createExpandControl(item: TreeItem, session: EditorSession, expanded: Set<string>): Node {
  if (!item.hasChildren) {
    const spacer = document.createElement("span")
    spacer.className = "composeui-editor__tree-toggle-spacer"
    spacer.setAttribute("aria-hidden", "true")
    return spacer
  }

  const button = document.createElement("button")
  const isExpanded = expanded.has(item.id)
  button.type = "button"
  button.className = "composeui-editor__tree-toggle"
  button.dataset.testid = `tree-toggle-${item.id}`
  button.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${item.name}`)
  button.setAttribute("aria-expanded", String(isExpanded))
  button.textContent = isExpanded ? "-" : "+"
  button.addEventListener("click", () => session.toggleExpanded(item.id))
  return button
}

export function renderComponentTree(
  store: RecordStore,
  pageId: string,
  session: EditorSession,
): HTMLElement {
  const state = session.getState()
  const expanded = new Set(state.expanded)
  const selected = new Set(state.selection)
  const tree = document.createElement("ul")
  tree.className = "composeui-editor__tree"
  tree.setAttribute("role", "tree")

  for (const item of getTreeItems(store, pageId, expanded)) {
    const treeItem = document.createElement("li")
    treeItem.className = "composeui-editor__tree-item"
    treeItem.dataset.visible = String(item.visible)
    treeItem.setAttribute("role", "treeitem")
    treeItem.setAttribute("aria-level", String(item.depth + 1))
    treeItem.setAttribute("aria-selected", String(selected.has(item.id)))
    if (item.hasChildren) treeItem.setAttribute("aria-expanded", String(expanded.has(item.id)))

    const row = document.createElement("div")
    row.className = "composeui-editor__tree-row"
    row.style.paddingInlineStart = `${item.depth * 16 + 8}px`
    row.append(createExpandControl(item, session, expanded))

    const selectButton = document.createElement("button")
    selectButton.type = "button"
    selectButton.className = "composeui-editor__tree-select"
    selectButton.dataset.testid = `tree-${item.id}`
    selectButton.setAttribute("aria-label", `Select ${item.name}`)
    selectButton.textContent = item.name
    selectButton.addEventListener("click", () => session.setSelection([item.id]))
    row.append(selectButton)
    treeItem.append(row)
    tree.append(treeItem)
  }

  return tree
}
