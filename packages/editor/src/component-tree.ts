import { getTreeItems } from "@composeui/core"
import type {
  Diagnostic,
  Editor,
  EditorChangeEvent,
  RecordStore,
  Result,
  TransactionPatch,
  TreeItem,
} from "@composeui/core"
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  File,
  Lock,
  Unlock,
  createElement as createIconElement,
} from "lucide"
import { EditorSession } from "./session"
import type { EditorSessionState } from "./session"

interface FocusTarget {
  testId: string
}

const TREE_DRAG_TYPE = "application/x-composeui-tree-node"

type TreeIcon = Parameters<typeof createIconElement>[0]

function icon(iconNode: TreeIcon): SVGElement {
  const element = createIconElement(iconNode)
  element.setAttribute("aria-hidden", "true")
  element.setAttribute("focusable", "false")
  return element
}

export interface ComponentTreeView {
  element: HTMLElement
  update(store: RecordStore, pageId: string, state: EditorSessionState, rebuild: boolean): void
}

export interface MountComponentTreeOptions {
  pageId: string
  session?: EditorSession
}

export interface MountedComponentTree {
  session: EditorSession
  update(store: RecordStore, pageId: string, state: EditorSessionState, rebuild: boolean): void
  destroy(): void
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

function selectItem(
  session: EditorSession,
  id: string,
  modifiers?: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
): void {
  if (modifiers?.shiftKey !== true && modifiers?.ctrlKey !== true && modifiers?.metaKey !== true) {
    session.setSelection([id])
    return
  }
  const selection = session.getState().selection
  session.setSelection(
    selection.includes(id)
      ? selection.filter((selectedId) => selectedId !== id)
      : [...selection, id],
  )
}

function handleTreeKeyDown(
  event: KeyboardEvent,
  button: HTMLButtonElement,
  session: EditorSession,
  onDelete?: (id: string) => void,
): void {
  const tree = button.closest("[role='tree']") as HTMLElement
  const buttons = treeButtons(tree)
  const index = buttons.findIndex((candidate) => candidate.dataset.treeId === button.dataset.treeId)
  if (index < 0) return

  let nextIndex: number | undefined
  switch (event.key) {
    case "Delete":
    case "Backspace":
      if (button.dataset.treeControl === "select" && button.dataset.treeId !== undefined) {
        event.preventDefault()
        onDelete?.(button.dataset.treeId)
      }
      return
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
      if (button.dataset.treeControl === "toggle") {
        session.toggleExpanded(button.dataset.treeId ?? "")
      } else {
        selectItem(session, button.dataset.treeId ?? "")
      }
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
  button.dataset.treeId = item.id
  button.tabIndex = -1
  button.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${item.name}`)
  button.setAttribute("aria-expanded", String(isExpanded))
  button.replaceChildren(icon(isExpanded ? ChevronDown : ChevronRight))
  button.addEventListener("click", () => session.toggleExpanded(item.id))
  button.addEventListener("keydown", (event) => handleTreeKeyDown(event, button, session))
  return button
}

function createActionButton(
  item: TreeItem,
  action: string,
  label: string,
  iconNode: TreeIcon,
  disabled: boolean,
  execute: () => void,
  pressed?: boolean,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "composeui-editor__tree-action"
  button.dataset.testid = `tree-${action}-${item.id}`
  button.tabIndex = -1
  button.disabled = disabled
  button.title = label
  button.setAttribute("aria-label", label)
  if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed))
  button.replaceChildren(icon(iconNode))
  button.addEventListener("click", (event) => {
    event.stopPropagation()
    execute()
  })
  return button
}

function reorderFailure(code: string, message: string, recordId: string): Result<void> {
  const diagnostic: Diagnostic = { code, severity: "error", message, recordId }
  return { ok: false, diagnostics: [diagnostic] }
}

function lockedTreeRecord(store: RecordStore, id: string): string | undefined {
  let record = store.get(id)
  while (record?.typeName === "node") {
    if (record.locked) return record.id
    record = store.get(record.parentId)
  }
  return undefined
}

export function reorderTreeItem(
  editor: Editor,
  store: RecordStore,
  sourceId: string,
  targetId: string,
): Result<void> {
  const source = store.get(sourceId)
  if (source?.typeName !== "node") {
    return reorderFailure(
      "TREE_REORDER_NODE_REQUIRED",
      `Tree reorder source ${sourceId} is not a node.`,
      sourceId,
    )
  }
  const target = store.get(targetId)
  if (target?.typeName !== "node") {
    return reorderFailure(
      "TREE_REORDER_NODE_REQUIRED",
      `Tree reorder target ${targetId} is not a node.`,
      targetId,
    )
  }
  if (source.id === target.id) {
    return reorderFailure(
      "TREE_REORDER_SAME_NODE",
      `Node ${source.id} cannot be dropped onto itself.`,
      source.id,
    )
  }
  if (source.parentId !== target.parentId) {
    return reorderFailure(
      "TREE_REORDER_PARENT_MISMATCH",
      `Nodes ${source.id} and ${target.id} do not share a parent.`,
      source.id,
    )
  }
  const lockedId = lockedTreeRecord(store, source.id) ?? lockedTreeRecord(store, target.id)
  if (lockedId !== undefined) {
    return reorderFailure("NODE_LOCKED", `Node ${lockedId} is locked.`, lockedId)
  }
  return editor.dispatch({
    id: "node.reorder",
    payload: { id: source.id, parentId: source.parentId, index: target.index },
  })
}

function canDragTreeItem(store: RecordStore, item: TreeItem): boolean {
  return item.typeName === "node" && lockedTreeRecord(store, item.id) === undefined
}

function beginRename(editor: Editor, item: TreeItem, selectButton: HTMLButtonElement): void {
  const input = document.createElement("input")
  input.className = "composeui-editor__tree-rename"
  input.dataset.testid = `tree-rename-${item.id}`
  input.setAttribute("aria-label", `Rename ${item.name}`)
  input.value = item.name
  selectButton.replaceWith(input)
  input.focus()
  input.select()

  let finished = false
  const finish = (commit: boolean): void => {
    if (finished) return
    finished = true
    const name = input.value.trim()
    if (commit && name.length > 0 && name !== item.name) {
      editor.dispatch({ id: "node.rename", payload: { id: item.id, name } })
      return
    }
    input.replaceWith(selectButton)
    selectButton.focus()
  }
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true)
    else if (event.key === "Escape") finish(false)
  })
  input.addEventListener("blur", () => finish(true))
}

function buildTree(
  tree: HTMLElement,
  store: RecordStore,
  pageId: string,
  state: EditorSessionState,
  session: EditorSession,
  editor: Editor,
): void {
  const expanded = new Set(state.expanded)
  const selected = new Set(state.selection)
  const fragment = document.createDocumentFragment()
  const items = getTreeItems(store, pageId, expanded)
  let draggedId: string | undefined

  const clearDropTargets = (): void => {
    for (const target of tree.querySelectorAll<HTMLElement>(
      ".composeui-editor__tree-row[data-drop-target='true']",
    )) {
      delete target.dataset.dropTarget
    }
  }

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
    row.dataset.testid = `tree-row-${item.id}`
    row.dataset.treeId = item.id
    row.draggable = canDragTreeItem(store, item)
    row.style.setProperty("--composeui-tree-depth", String(item.depth))
    row.addEventListener("dragstart", (event) => {
      if (!row.draggable || event.dataTransfer === null) {
        event.preventDefault()
        return
      }
      draggedId = item.id
      clearDropTargets()
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData(TREE_DRAG_TYPE, item.id)
      event.dataTransfer.setData("text/plain", item.id)
      row.dataset.dragging = "true"
    })
    row.addEventListener("dragover", (event) => {
      if (draggedId === undefined) return
      const source = store.get(draggedId)
      const target = store.get(item.id)
      if (
        source?.typeName !== "node" ||
        target?.typeName !== "node" ||
        source.id === target.id ||
        source.parentId !== target.parentId ||
        lockedTreeRecord(store, source.id) !== undefined ||
        lockedTreeRecord(store, target.id) !== undefined
      ) {
        clearDropTargets()
        return
      }
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move"
      clearDropTargets()
      row.dataset.dropTarget = "true"
    })
    row.addEventListener("dragleave", () => {
      delete row.dataset.dropTarget
    })
    row.addEventListener("drop", (event) => {
      event.preventDefault()
      const sourceId = draggedId ?? event.dataTransfer?.getData(TREE_DRAG_TYPE)
      draggedId = undefined
      clearDropTargets()
      if (sourceId !== undefined && sourceId.length > 0) {
        reorderTreeItem(editor, store, sourceId, item.id)
      }
    })
    row.addEventListener("dragend", () => {
      draggedId = undefined
      clearDropTargets()
      delete row.dataset.dragging
    })
    row.append(createExpandControl(item, session, expanded))

    const typeIcon = document.createElement("span")
    typeIcon.className = "composeui-editor__tree-type-icon"
    typeIcon.dataset.testid = `tree-icon-${item.id}`
    typeIcon.setAttribute("aria-hidden", "true")
    typeIcon.append(icon(item.typeName === "page" ? File : Box))
    row.append(typeIcon)

    const selectButton = document.createElement("button")
    selectButton.type = "button"
    selectButton.className = "composeui-editor__tree-select"
    selectButton.dataset.testid = `tree-${item.id}`
    selectButton.dataset.treeControl = "select"
    selectButton.dataset.treeId = item.id
    selectButton.tabIndex = index === 0 ? 0 : -1
    selectButton.setAttribute("aria-label", `Select ${item.name}`)
    selectButton.textContent = item.name
    selectButton.addEventListener("click", (event) => {
      selectItem(session, item.id, event)
      if (item.hasChildren) session.toggleExpanded(item.id)
    })
    if (item.typeName === "node") {
      selectButton.addEventListener("dblclick", () => beginRename(editor, item, selectButton))
    }
    selectButton.addEventListener("keydown", (event) =>
      handleTreeKeyDown(event, selectButton, session, (id) => {
        if (item.typeName !== "node") return
        const result = editor.dispatch({ id: "node.delete", payload: { ids: [id] } })
        if (result.ok) session.setSelection([])
      }),
    )
    row.append(selectButton)
    if (item.typeName === "node") {
      row.append(
        createActionButton(
          item,
          "visibility",
          `${item.visible ? "Hide" : "Show"} ${item.name}`,
          item.visible ? Eye : EyeOff,
          false,
          () =>
            editor.dispatch({
              id: "node.setVisible",
              payload: { id: item.id, visible: !item.visible },
            }),
          item.visible,
        ),
        createActionButton(
          item,
          "lock",
          `${item.locked ? "Unlock" : "Lock"} ${item.name}`,
          item.locked ? Lock : Unlock,
          false,
          () =>
            editor.dispatch({
              id: "node.setLocked",
              payload: { id: item.id, locked: !item.locked },
            }),
          item.locked,
        ),
      )
    }
    treeItem.append(row)
    fragment.append(treeItem)
  }
  tree.replaceChildren(fragment)
}

export function treeNeedsUpdate(patch: TransactionPatch): boolean {
  if (patch.created.length > 0 || patch.removed.length > 0) return true
  return patch.updated.some(({ before, after }) => {
    if (before.typeName !== after.typeName) return true
    if (before.typeName === "page" && after.typeName === "page") {
      return before.name !== after.name
    }
    if (before.typeName !== "node" || after.typeName !== "node") return false
    return (
      before.name !== after.name ||
      before.parentId !== after.parentId ||
      before.index !== after.index ||
      before.visible !== after.visible ||
      before.locked !== after.locked
    )
  })
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function createComponentTree(
  store: RecordStore,
  pageId: string,
  state: EditorSessionState,
  session: EditorSession,
  editor: Editor,
): ComponentTreeView {
  const tree = document.createElement("ul")
  tree.className = "composeui-editor__tree"
  tree.setAttribute("role", "tree")
  buildTree(tree, store, pageId, state, session, editor)

  return {
    element: tree,
    update(nextStore, nextPageId, nextState, rebuild) {
      if (rebuild) {
        const focusTarget = captureFocus(tree)
        const scrollTop = tree.scrollTop
        const scrollLeft = tree.scrollLeft
        buildTree(tree, nextStore, nextPageId, nextState, session, editor)
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

export function mountComponentTreeView(
  root: HTMLElement,
  editor: Editor,
  options: MountComponentTreeOptions,
  subscribe = true,
): MountedComponentTree {
  const page = editor.getRecord(options.pageId)
  if (page?.typeName !== "page") throw new Error("PAGE_NOT_FOUND")

  const session = options.session ?? new EditorSession()
  if (!session.getState().expanded.includes(options.pageId)) {
    session.toggleExpanded(options.pageId)
  }
  let state = session.getState()
  const tree = createComponentTree(editor.getStore(), options.pageId, state, session, editor)
  root.replaceChildren(tree.element)
  let store = editor.getStore()
  let destroyed = false

  const onCoreChange = (event: EditorChangeEvent): void => {
    if (destroyed) return
    store = event.store
    if (treeNeedsUpdate(event.transaction.forward)) tree.update(store, options.pageId, state, true)
  }
  const onSessionChange = (nextState: EditorSessionState): void => {
    if (destroyed) return
    const expandedChanged = !sameArray(state.expanded, nextState.expanded)
    const selectionChanged = !sameArray(state.selection, nextState.selection)
    state = nextState
    if (expandedChanged) tree.update(store, options.pageId, nextState, true)
    else if (selectionChanged) tree.update(store, options.pageId, nextState, false)
  }

  const unsubscribeCore = subscribe ? editor.subscribe(onCoreChange) : () => {}
  const unsubscribeSession = subscribe ? session.subscribe(onSessionChange) : () => {}

  return {
    session,
    update: tree.update,
    destroy() {
      if (destroyed) return
      destroyed = true
      unsubscribeCore()
      unsubscribeSession()
      root.replaceChildren()
    },
  }
}

export function mountComponentTree(
  root: HTMLElement,
  editor: Editor,
  options: MountComponentTreeOptions,
): MountedComponentTree {
  const aside = document.createElement("aside")
  aside.className = "composeui-editor__component-tree"
  aside.setAttribute("aria-label", "节点树")
  root.replaceChildren(aside)
  const mounted = mountComponentTreeView(aside, editor, options)
  return {
    session: mounted.session,
    update: mounted.update,
    destroy() {
      mounted.destroy()
      aside.remove()
    },
  }
}
