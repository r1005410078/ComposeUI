import { getTreeItems } from "@composeui/core"
import type { RecordStore, TreeItem } from "@composeui/core"
import type { EditorSession, EditorSessionState } from "./session"

interface FocusTarget {
  testId: string
}

export interface ComponentTreeView {
  element: HTMLElement
  update(store: RecordStore, pageId: string, state: EditorSessionState, rebuild: boolean): void
}

function treeButtons(tree: HTMLElement): HTMLButtonElement[] {
  return [...tree.querySelectorAll<HTMLButtonElement>("[data-tree-control='select']")]
}

function captureFocus(tree: HTMLElement): FocusTarget | undefined {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !tree.contains(active)) return undefined
  const testId = active.dataset.testid
  return testId === undefined ? undefined : { testId }
}

function restoreFocus(tree: HTMLElement, target: FocusTarget | undefined): void {
  if (target === undefined) return
  for (const button of tree.querySelectorAll<HTMLButtonElement>("[data-testid]")) {
    if (button.dataset.testid === target.testId) {
      button.focus()
      return
    }
  }
}

function selectItem(session: EditorSession, id: string): void {
  session.setSelection([id])
}

function handleTreeKeyDown(
  event: KeyboardEvent,
  button: HTMLButtonElement,
  session: EditorSession,
): void {
  const buttons = treeButtons(button.closest("[role='tree']") as HTMLElement)
  const index = buttons.indexOf(button)
  if (index < 0) return

  let nextIndex: number | undefined
  switch (event.key) {
    case "ArrowUp":
      nextIndex = Math.max(0, index - 1)
      break
    case "ArrowDown":
      nextIndex = Math.min(buttons.length - 1, index + 1)
      break
    case "Home":
      nextIndex = 0
      break
    case "End":
      nextIndex = buttons.length - 1
      break
    case "Enter":
    case " ":
    case "Spacebar":
      event.preventDefault()
      selectItem(session, button.dataset.treeId ?? "")
      return
    default:
      return
  }

  event.preventDefault()
  buttons[nextIndex]?.focus()
}

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
  button.dataset.treeControl = "toggle"
  button.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${item.name}`)
  button.setAttribute("aria-expanded", String(isExpanded))
  button.textContent = isExpanded ? "-" : "+"
  button.addEventListener("click", () => session.toggleExpanded(item.id))
  return button
}

function buildTree(
  tree: HTMLElement,
  store: RecordStore,
  pageId: string,
  state: EditorSessionState,
  session: EditorSession,
): void {
  const expanded = new Set(state.expanded)
  const selected = new Set(state.selection)
  const fragment = document.createDocumentFragment()
  const items = getTreeItems(store, pageId, expanded)

  for (const [index, item] of items.entries()) {
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
    selectButton.dataset.treeControl = "select"
    selectButton.dataset.treeId = item.id
    selectButton.tabIndex = index === 0 ? 0 : -1
    selectButton.setAttribute("aria-label", `Select ${item.name}`)
    selectButton.textContent = item.name
    selectButton.addEventListener("click", () => selectItem(session, item.id))
    selectButton.addEventListener("keydown", (event) =>
      handleTreeKeyDown(event, selectButton, session),
    )
    row.append(selectButton)
    treeItem.append(row)
    fragment.append(treeItem)
  }
  tree.replaceChildren(fragment)
}

export function createComponentTree(
  store: RecordStore,
  pageId: string,
  state: EditorSessionState,
  session: EditorSession,
): ComponentTreeView {
  const tree = document.createElement("ul")
  tree.className = "composeui-editor__tree"
  tree.setAttribute("role", "tree")
  buildTree(tree, store, pageId, state, session)

  return {
    element: tree,
    update(nextStore, nextPageId, nextState, rebuild) {
      if (rebuild) {
        const focusTarget = captureFocus(tree)
        const scrollTop = tree.scrollTop
        const scrollLeft = tree.scrollLeft
        buildTree(tree, nextStore, nextPageId, nextState, session)
        tree.scrollTop = scrollTop
        tree.scrollLeft = scrollLeft
        restoreFocus(tree, focusTarget)
        return
      }

      const selected = new Set(nextState.selection)
      for (const treeItem of tree.querySelectorAll<HTMLElement>("[role='treeitem']")) {
        const button = treeItem.querySelector<HTMLButtonElement>("[data-tree-control='select']")
        if (button !== null)
          treeItem.setAttribute("aria-selected", String(selected.has(button.dataset.treeId ?? "")))
      }
    },
  }
}
