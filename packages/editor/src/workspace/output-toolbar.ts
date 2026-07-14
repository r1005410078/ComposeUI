import type { OperationCategory, OperationStatus } from "@composeui/operation-log"
import { Filter, MoreHorizontal, Play, RotateCcw, Search, createElement } from "lucide"

const filterLevels = [
  "observed",
  "started",
  "succeeded",
  "failed",
] as const satisfies readonly OperationStatus[]
const filterCategories = [
  "document",
  "history",
  "session",
  "workspace",
  "diagnostic",
  "system",
] as const satisfies readonly OperationCategory[]

const filterLevelLabels: Record<OperationStatus, string> = {
  observed: "记录",
  started: "开始",
  succeeded: "成功",
  failed: "失败",
}

const filterCategoryLabels: Record<OperationCategory, string> = {
  document: "文档",
  history: "历史",
  session: "会话",
  workspace: "工作区",
  diagnostic: "诊断",
  system: "系统",
}

let nextFilterPopoverId = 0

function isSelected<Value extends string>(selected: readonly Value[], value: Value): boolean {
  return selected.length === 0 || selected.includes(value)
}

function normalize<Value extends string>(selected: readonly Value[], all: readonly Value[]): Value[] {
  return selected.length === all.length ? [] : [...selected]
}

export interface OutputToolbarModel {
  readonly levels: readonly OperationStatus[]
  readonly categories: readonly OperationCategory[]
  readonly search: string
  readonly autoScroll: boolean
  readonly selectedSequence?: number
  readonly canReplaySelection: boolean
  readonly busyAction?: string
}

export interface OutputToolbarActions {
  onSearch(search: string): void
  onFilterChange(levels: readonly OperationStatus[], categories: readonly OperationCategory[]): void
  onResetFilters(): void
  onAutoScrollChange(autoScroll: boolean): void
  onImport(file: File): void
  onExport(): void
  onClearView(): void
  onReplaySelected(sequence: number): void
}

export interface OutputToolbarMount {
  update(model: OutputToolbarModel): void
  dispose(): void
}

function actionButton(
  testid: string,
  label: string,
  icon: Parameters<typeof createElement>[0],
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "composeui-editor__output-button"
  button.dataset.testid = testid
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createElement(icon), document.createTextNode(label))
  button.addEventListener("click", onClick)
  return button
}

function menuItem(testid: string, label: string, onClick: () => void): HTMLButtonElement {
  const item = document.createElement("button")
  item.type = "button"
  item.className = "composeui-editor__output-menu-item"
  item.dataset.testid = testid
  item.setAttribute("role", "menuitem")
  item.textContent = label
  item.addEventListener("click", onClick)
  return item
}

export function mountOutputToolbar(
  root: HTMLElement,
  actions: OutputToolbarActions,
): OutputToolbarMount {
  root.className = "composeui-editor__output-toolbar"
  root.dataset.testid = "output-toolbar"

  let disposed = false
  let model: OutputToolbarModel = {
    levels: [],
    categories: [],
    search: "",
    autoScroll: true,
    canReplaySelection: false,
  }
  let pendingFilterFocus:
    | { readonly attribute: "filterLevel" | "filterCategory"; readonly value: string }
    | undefined
  const searchLabel = document.createElement("label")
  searchLabel.className = "composeui-editor__output-search"
  searchLabel.append(createElement(Search))
  const searchInput = document.createElement("input")
  searchInput.type = "search"
  searchInput.placeholder = "搜索操作日志"
  searchInput.setAttribute("aria-label", "搜索操作日志")
  searchInput.addEventListener("input", () => actions.onSearch(searchInput.value))
  searchLabel.append(searchInput)

  const filterHost = document.createElement("span")
  filterHost.className = "composeui-editor__output-filter-host"
  const filterPopoverId = `composeui-output-filter-popover-${++nextFilterPopoverId}`
  const filter = actionButton("output-filter-trigger", "筛选", Filter, () => {
    if (filterPopover.isConnected) closeFilter(false)
    else {
      closeMenu(false)
      openFilter()
    }
  })
  filter.setAttribute("aria-haspopup", "dialog")
  filter.setAttribute("aria-expanded", "false")
  filter.setAttribute("aria-controls", filterPopoverId)
  filterHost.append(filter)
  const autoScroll = actionButton("output-auto-scroll", "自动滚动", RotateCcw, () => {
    actions.onAutoScrollChange(!model.autoScroll)
  })
  const more = actionButton("output-more-trigger", "更多操作", MoreHorizontal, () => {
    if (menu.isConnected) closeMenu(false)
    else openMenu()
  })
  more.setAttribute("aria-haspopup", "menu")
  more.setAttribute("aria-expanded", "false")
  const menuHost = document.createElement("span")
  menuHost.className = "composeui-editor__output-menu-host"
  menuHost.append(more)
  const fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.accept = ".json,application/json"
  fileInput.hidden = true
  fileInput.dataset.testid = "output-import-input"
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0]
    if (file !== undefined) actions.onImport(file)
    fileInput.value = ""
  })
  const menu = document.createElement("div")
  menu.className = "composeui-editor__output-menu"
  menu.dataset.testid = "output-more-menu"
  menu.setAttribute("role", "menu")
  menu.setAttribute("aria-label", "更多操作")
  const importItem = menuItem("output-import", "导入日志", () => {
    closeMenu(false)
    fileInput.click()
  })
  const exportItem = menuItem("output-export", "导出日志", () => {
    closeMenu(false)
    actions.onExport()
  })
  const scrollItem = menuItem("output-menu-scroll", "", () => {
    closeMenu(false)
    actions.onAutoScrollChange(!model.autoScroll)
  })
  const clearItem = menuItem("output-clear", "清空当前视图", () => {
    closeMenu(false)
    actions.onClearView()
  })
  menu.append(importItem, exportItem, scrollItem, clearItem)
  const filterPopover = document.createElement("div")
  filterPopover.className = "composeui-editor__output-filter-popover"
  filterPopover.id = filterPopoverId
  filterPopover.dataset.testid = "output-filter-popover"
  filterPopover.setAttribute("role", "dialog")
  filterPopover.setAttribute("aria-label", "筛选操作日志")
  const filterOptions = document.createElement("div")
  filterOptions.className = "composeui-editor__output-filter-options"
  const filterActions = document.createElement("div")
  filterActions.className = "composeui-editor__output-filter-actions"
  const resetFilters = document.createElement("button")
  resetFilters.type = "button"
  resetFilters.className = "composeui-editor__output-menu-item"
  resetFilters.dataset.testid = "output-filter-reset"
  resetFilters.textContent = "重置"
  resetFilters.addEventListener("click", () => actions.onResetFilters())
  const closeFilters = document.createElement("button")
  closeFilters.type = "button"
  closeFilters.className = "composeui-editor__output-menu-item"
  closeFilters.dataset.testid = "output-filter-close"
  closeFilters.textContent = "完成"
  closeFilters.addEventListener("click", () => closeFilter(true))
  filterActions.append(resetFilters, closeFilters)
  filterPopover.append(filterOptions, filterActions)
  const openMenu = (): void => {
    if (disposed || menu.isConnected) return
    closeFilter(false)
    menuHost.append(menu)
    more.setAttribute("aria-expanded", "true")
  }
  const closeMenu = (restoreFocus: boolean): void => {
    if (!menu.isConnected) return
    menu.remove()
    more.setAttribute("aria-expanded", "false")
    if (restoreFocus) more.focus()
  }
  const changeFilter = <Value extends OperationStatus | OperationCategory>(
    selected: readonly Value[],
    all: readonly Value[],
    value: Value,
    checked: boolean,
  ): Value[] => {
    const expanded = selected.length === 0 ? [...all] : [...selected]
    const next = checked
      ? [...new Set([...expanded, value])]
      : expanded.filter((item) => item !== value)
    return normalize(next, all)
  }
  const renderFilterOptions = (): void => {
    filterOptions.replaceChildren()
    const addOption = <Value extends OperationStatus | OperationCategory>(
      value: Value,
      label: string,
      selected: readonly Value[],
      all: readonly Value[],
      attribute: "filterLevel" | "filterCategory",
    ): void => {
      const option = document.createElement("label")
      option.className = "composeui-editor__output-filter-option"
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      checkbox.checked = isSelected(selected, value)
      checkbox.dataset[attribute] = value
      checkbox.addEventListener("click", () => {
        const focus =
          document.activeElement === checkbox ? { attribute, value: String(value) } : undefined
        pendingFilterFocus = focus
        const next = changeFilter(selected, all, value, checkbox.checked)
        if (attribute === "filterLevel") {
          actions.onFilterChange(next as OperationStatus[], model.categories)
        } else {
          actions.onFilterChange(model.levels, next as OperationCategory[])
        }
        if (pendingFilterFocus === focus) pendingFilterFocus = undefined
      })
      option.append(checkbox, document.createTextNode(label))
      filterOptions.append(option)
    }
    for (const level of filterLevels) {
      addOption(level, filterLevelLabels[level], model.levels, filterLevels, "filterLevel")
    }
    for (const category of filterCategories) {
      addOption(
        category,
        filterCategoryLabels[category],
        model.categories,
        filterCategories,
        "filterCategory",
      )
    }
    const focus = pendingFilterFocus
    pendingFilterFocus = undefined
    if (focus !== undefined) {
      Array.from(filterOptions.querySelectorAll<HTMLInputElement>("input[type='checkbox']"))
        .find((checkbox) => checkbox.dataset[focus.attribute] === focus.value)
        ?.focus()
    }
  }
  const openFilter = (): void => {
    if (disposed || filterPopover.isConnected) return
    renderFilterOptions()
    filterHost.append(filterPopover)
    filter.setAttribute("aria-expanded", "true")
  }
  const closeFilter = (restoreFocus: boolean): void => {
    if (!filterPopover.isConnected) return
    filterPopover.remove()
    filter.setAttribute("aria-expanded", "false")
    if (restoreFocus) filter.focus()
  }
  const onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && filterPopover.isConnected) {
      event.preventDefault()
      closeFilter(true)
    } else if (event.key === "Escape" && menu.isConnected) {
      event.preventDefault()
      closeMenu(true)
    }
  }
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (menu.isConnected && event.target instanceof Node && !root.contains(event.target)) {
      closeMenu(false)
    }
    if (filterPopover.isConnected && event.target instanceof Node && !root.contains(event.target)) {
      closeFilter(false)
    }
  }
  filterPopover.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const checkboxes = Array.from(
      filterPopover.querySelectorAll<HTMLInputElement>("input[type='checkbox']"),
    )
    const index = checkboxes.indexOf(document.activeElement as HTMLInputElement)
    if (index === -1) return
    event.preventDefault()
    const direction = event.key === "ArrowDown" ? 1 : -1
    checkboxes[(index + direction + checkboxes.length) % checkboxes.length]?.focus()
  })
  document.addEventListener("keydown", onDocumentKeydown)
  document.addEventListener("pointerdown", onDocumentPointerDown)
  const replayHost = document.createElement("span")
  replayHost.dataset.testid = "output-replay-host"
  root.replaceChildren(searchLabel, filterHost, autoScroll, menuHost, replayHost, fileInput)

  const render = (): void => {
    searchInput.value = model.search
    const activeFilterCount = model.levels.length + model.categories.length
    filter.replaceChildren(
      createElement(Filter),
      document.createTextNode(`筛选${activeFilterCount === 0 ? "" : ` ${activeFilterCount}`}`),
    )
    if (filterPopover.isConnected) renderFilterOptions()
    autoScroll.setAttribute("aria-pressed", String(model.autoScroll))
    autoScroll.disabled = model.busyAction === "auto-scroll"
    scrollItem.textContent = model.autoScroll ? "自动滚动：开" : "自动滚动：关"
    replayHost.replaceChildren()
    if (!model.canReplaySelection || model.selectedSequence === undefined) return
    const sequence = model.selectedSequence
    const replay = actionButton("output-replay", "回放到此处", Play, () => {
      actions.onReplaySelected(sequence)
    })
    replay.disabled = model.busyAction === "replay"
    replayHost.append(replay)
  }

  render()
  return {
    update(nextModel) {
      if (disposed) return
      model = nextModel
      render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      document.removeEventListener("keydown", onDocumentKeydown)
      document.removeEventListener("pointerdown", onDocumentPointerDown)
      root.replaceChildren()
    },
  }
}
