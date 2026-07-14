// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { mountOutputToolbar } from "../src/workspace/output-toolbar"

function actions() {
  return {
    onSearch: vi.fn(),
    onFilterChange: vi.fn(),
    onResetFilters: vi.fn(),
    onAutoScrollChange: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onClearView: vi.fn(),
    onReplaySelected: vi.fn(),
  }
}

describe("mountOutputToolbar", () => {
  it("renders the default contextual controls", () => {
    const root = document.createElement("div")
    const mounted = mountOutputToolbar(root, actions())

    expect(root.querySelector("input[aria-label='搜索操作日志']")).not.toBeNull()
    const filter = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")
    expect(filter).not.toBeNull()
    expect(filter?.disabled).toBe(false)
    expect(filter?.textContent).toContain("筛选")
    expect(filter?.getAttribute("aria-expanded")).toBe("false")
    expect(root.querySelector("[data-testid='output-auto-scroll']")).not.toBeNull()
    const more = root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")
    expect(more).not.toBeNull()
    expect(more?.disabled).toBe(false)
    expect(root.querySelector("[data-testid='output-import']")).toBeNull()
    expect(root.querySelector("[data-testid='output-export']")).toBeNull()
    expect(root.querySelector("[data-testid='output-clear']")).toBeNull()
    expect(root.querySelector("[data-testid='output-replay']")).toBeNull()

    mounted.dispose()
    expect(() => mounted.dispose()).not.toThrow()
  })

  it("uses empty filter arrays as checked wildcard selections and normalizes all checked", () => {
    const root = document.createElement("div")
    const toolbarActions = actions()
    const mounted = mountOutputToolbar(root, toolbarActions)
    const filter = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!

    filter.click()
    const popover = root.querySelector<HTMLElement>("[data-testid='output-filter-popover']")!
    expect(popover.getAttribute("role")).toBe("dialog")
    expect(filter.getAttribute("aria-controls")).toBe(popover.id)
    expect(filter.getAttribute("aria-expanded")).toBe("true")
    expect(popover.querySelectorAll("input[type='checkbox']")).toHaveLength(10)
    expect(popover.querySelector<HTMLInputElement>("[data-filter-level='observed']")?.checked).toBe(
      true,
    )
    expect(
      popover.querySelector<HTMLInputElement>("[data-filter-category='system']")?.checked,
    ).toBe(true)

    const observed = popover.querySelector<HTMLInputElement>("[data-filter-level='observed']")!
    root.querySelector<HTMLInputElement>("[data-filter-level='observed']")!.click()
    expect(toolbarActions.onFilterChange).toHaveBeenLastCalledWith(
      ["started", "succeeded", "failed"],
      [],
    )

    mounted.update({
      levels: ["started", "succeeded", "failed"],
      categories: [],
      search: "",
      autoScroll: true,
      canReplaySelection: false,
    })
    observed.click()
    expect(toolbarActions.onFilterChange).toHaveBeenLastCalledWith([], [])
  })

  it("shows active filters, resets, and keeps the popover open while toggling", () => {
    const root = document.createElement("div")
    const toolbarActions = actions()
    const mounted = mountOutputToolbar(root, toolbarActions)
    mounted.update({
      levels: ["failed"],
      categories: ["diagnostic", "system"],
      search: "",
      autoScroll: true,
      canReplaySelection: false,
    })
    const filter = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!
    expect(filter.textContent).toContain("筛选 3")

    filter.click()
    root.querySelector<HTMLInputElement>("[data-filter-level='failed']")!.click()
    expect(root.querySelector("[data-testid='output-filter-popover']")).not.toBeNull()
    root.querySelector<HTMLButtonElement>("[data-testid='output-filter-reset']")!.click()
    expect(toolbarActions.onResetFilters).toHaveBeenCalledTimes(1)
  })

  it("preserves toggle focus through a controlled filter update for Arrow navigation", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const toolbarActions = actions()
    const mounted = mountOutputToolbar(root, toolbarActions)
    toolbarActions.onFilterChange.mockImplementation((levels, categories) => {
      mounted.update({
        levels,
        categories,
        search: "",
        autoScroll: true,
        canReplaySelection: false,
      })
    })

    root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!.click()
    const observed = root.querySelector<HTMLInputElement>("[data-filter-level='observed']")!
    observed.focus()
    observed.click()

    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>("[data-filter-level='observed']"),
    )
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>("[data-filter-level='started']"),
    )

    mounted.dispose()
    root.remove()
  })

  it("assigns each mounted Filter popover a distinct trigger-controlled id", () => {
    const firstRoot = document.createElement("div")
    const secondRoot = document.createElement("div")
    const first = mountOutputToolbar(firstRoot, actions())
    const second = mountOutputToolbar(secondRoot, actions())
    const firstTrigger = firstRoot.querySelector<HTMLButtonElement>(
      "[data-testid='output-filter-trigger']",
    )!
    const secondTrigger = secondRoot.querySelector<HTMLButtonElement>(
      "[data-testid='output-filter-trigger']",
    )!

    firstTrigger.click()
    secondTrigger.click()
    const firstId = firstTrigger.getAttribute("aria-controls")
    const secondId = secondTrigger.getAttribute("aria-controls")

    expect(firstId).not.toBeNull()
    expect(secondId).not.toBeNull()
    expect(firstId).not.toBe(secondId)
    expect(firstRoot.querySelector("[data-testid='output-filter-popover']")?.id).toBe(firstId)
    expect(secondRoot.querySelector("[data-testid='output-filter-popover']")?.id).toBe(secondId)

    first.dispose()
    second.dispose()
  })

  it("closes Filter on Escape, restores focus, moves checkbox focus with arrows, and closes More", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const mounted = mountOutputToolbar(root, actions())
    const filter = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!
    const more = root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!

    filter.click()
    const observed = root.querySelector<HTMLInputElement>("[data-filter-level='observed']")!
    observed.focus()
    observed.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>("[data-filter-level='started']"),
    )
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    )
    expect(document.activeElement).toBe(observed)

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(root.querySelector("[data-testid='output-filter-popover']")).toBeNull()
    expect(document.activeElement).toBe(filter)

    filter.click()
    more.click()
    expect(root.querySelector("[data-testid='output-filter-popover']")).toBeNull()
    expect(root.querySelector("[data-testid='output-more-menu']")).not.toBeNull()

    more.click()
    filter.click()
    const outside = document.createElement("div")
    document.body.append(outside)
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(root.querySelector("[data-testid='output-filter-popover']")).toBeNull()

    mounted.dispose()
    outside.remove()
    root.remove()
  })

  it("opens More actions and closes on Escape with trigger focus restored", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const toolbarActions = actions()
    mountOutputToolbar(root, toolbarActions)
    const more = root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!

    more.click()
    expect(root.querySelector("[role='menu']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-import']")?.textContent).toContain("导入日志")
    expect(root.querySelector("[data-testid='output-export']")?.textContent).toContain("导出日志")
    expect(root.querySelector("[data-testid='output-menu-scroll']")?.textContent).toContain(
      "自动滚动：开",
    )
    expect(root.querySelector("[data-testid='output-clear']")?.textContent).toContain(
      "清空当前视图",
    )

    root.querySelector<HTMLButtonElement>("[data-testid='output-menu-scroll']")!.click()
    expect(toolbarActions.onAutoScrollChange).toHaveBeenCalledWith(false)
    more.click()
    root.querySelector<HTMLButtonElement>("[data-testid='output-clear']")!.click()
    expect(toolbarActions.onClearView).toHaveBeenCalledTimes(1)

    more.click()
    const outside = document.createElement("div")
    document.body.append(outside)
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(root.querySelector("[role='menu']")).toBeNull()

    more.click()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(root.querySelector("[role='menu']")).toBeNull()
    expect(document.activeElement).toBe(more)
    outside.remove()
    root.remove()
  })

  it("shows selected replay and calls the action with its sequence", () => {
    const root = document.createElement("div")
    const toolbarActions = actions()
    const mounted = mountOutputToolbar(root, toolbarActions)

    mounted.update({
      levels: [],
      categories: [],
      search: "",
      autoScroll: true,
      selectedSequence: 42,
      canReplaySelection: true,
    })
    root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()

    expect(root.querySelector("[data-testid='output-replay']")?.textContent).toContain("回放到此处")
    expect(toolbarActions.onReplaySelected).toHaveBeenCalledWith(42)
  })
})
