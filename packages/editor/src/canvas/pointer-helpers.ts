/**
 * @module pointer-helpers
 *
 * 指针控制器用的纯工具：修饰键、选区切换、workspace 坐标。
 */

export interface ActivePointerInteraction {
  cancel(): void
}

export function hasSelectionModifier(
  event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey
}

export function toggleSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id)
    ? selection.filter((selectedId) => selectedId !== id)
    : [...selection, id]
}

export function workspacePoint(
  event: MouseEvent,
  workspace: HTMLElement,
): { x: number; y: number } {
  const bounds = workspace.getBoundingClientRect()
  return {
    x: event.clientX - bounds.left + workspace.scrollLeft,
    y: event.clientY - bounds.top + workspace.scrollTop,
  }
}
