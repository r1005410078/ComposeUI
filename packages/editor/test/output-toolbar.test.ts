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
    expect(filter?.disabled).toBe(true)
    expect(filter?.getAttribute("aria-disabled")).toBe("true")
    expect(filter?.title).toBe("筛选功能将在下一步启用")
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
    expect(root.querySelector("[data-testid='output-clear']")?.textContent).toContain("清空当前视图")

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
