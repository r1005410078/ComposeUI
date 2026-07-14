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
    expect(root.querySelector("[data-testid='output-filter-trigger']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-auto-scroll']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-more-trigger']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-replay']")).toBeNull()

    mounted.dispose()
    expect(() => mounted.dispose()).not.toThrow()
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
