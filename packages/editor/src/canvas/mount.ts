/**
 * @module mount
 *
 * 画布与可选组合壳的 DOM 挂载装配：shell、board、overlay、pointer、preview 订阅与销毁。
 *
 * 架构分层：
 * - Document：core Editor + RecordStore（节点几何与属性）
 * - Session：viewport / selection / pan 模式（不入文档）
 * - 预览：EditorPreviewSource 可覆盖展示用 document/session（回放只读预览）
 *
 * 数据流：mountEditor → 订阅 editor + session → 重绘 board；交互 → dispatch。
 */

import type { Editor, EditorChangeEvent } from "@composeui/core"
import { mountComponentTreeView, treeNeedsUpdate } from "../tree/component-tree"
import type { MountedComponentTree } from "../tree/component-tree"
import { EditorSession } from "../session/session"
import type { EditorSessionState } from "../session/session"
import { createCanvasView, canvasNeedsRebuild } from "./board-render"
import { SVG_NAMESPACE, renderSelectionOverlay } from "./overlay"
import { createPointerController } from "./pointer"
import {
  previewStore,
  subscribePreview,
  treeSessionState,
  updateReplayBanner,
  type EditorPreviewFrame,
  type EditorPreviewSource,
} from "./preview"

export type { EditorPreviewFrame, EditorPreviewSource }

export interface MountEditorOptions {
  pageId: string
  session?: EditorSession
  /** combined：画布+内嵌树；canvas：仅画布（workspace 分栏时用）。 */
  view?: "combined" | "canvas"
  /** 回放/只读预览源；active 时展示预览帧而非 live store。 */
  preview?: EditorPreviewSource
}

export interface MountedEditor {
  session: EditorSession
  destroy(): void
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * 将编辑器挂到 host 容器。
 * @param coreEditor 已装载文档的 core Editor（权威写入口）
 * @returns destroy 时释放 DOM 与订阅；Session 若为外部传入则不销毁实例本身
 */
export function mountEditor(
  root: HTMLElement,
  coreEditor: Editor,
  options: MountEditorOptions,
): MountedEditor {
  const initialPage = coreEditor.getRecord(options.pageId)
  if (initialPage?.typeName !== "page") throw new Error("PAGE_NOT_FOUND")

  let previewFrame = options.preview?.getState() ?? { active: false }
  const session = options.session ?? new EditorSession()
  if (!previewFrame.active && !session.getState().expanded.includes(options.pageId)) {
    session.toggleExpanded(options.pageId)
  }
  let sourceSessionState = session.getState()
  let sessionState = previewFrame.active
    ? (previewFrame.session ?? sourceSessionState)
    : sourceSessionState
  const isPreviewActive = (): boolean => previewFrame.active

  const shell = document.createElement("section")
  shell.className = "composeui-editor"
  if (options.view === "canvas") shell.classList.add("composeui-editor--canvas-only")
  shell.dataset.testid = "editor-shell"
  shell.dataset.mode = "stage-edit"
  shell.tabIndex = 0
  const aside = document.createElement("aside")
  aside.className = "composeui-editor__component-tree"
  aside.setAttribute("aria-label", "节点树")
  const workspace = document.createElement("main")
  workspace.className = "composeui-editor__workspace"
  workspace.dataset.testid = "workspace"
  workspace.setAttribute("aria-label", "Workspace")
  const world = document.createElement("div")
  world.className = "composeui-editor__world"
  world.dataset.testid = "world"
  const board = document.createElement("section")
  board.className = "composeui-editor__page-board"
  board.dataset.testid = "page-board"
  board.setAttribute("aria-label", "页面画布")
  const overlay = document.createElementNS(SVG_NAMESPACE, "svg")
  overlay.classList.add("composeui-editor__selection-overlay")
  overlay.dataset.testid = "selection-overlay"
  overlay.setAttribute("aria-label", "Selection overlay")
  const grid = document.createElement("div")
  grid.className = "composeui-editor__workspace-grid"
  grid.dataset.testid = "workspace-grid"
  grid.setAttribute("aria-hidden", "true")
  const replayBanner = document.createElement("div")
  replayBanner.dataset.testid = "replay-canvas-banner"
  replayBanner.setAttribute("role", "status")

  world.append(board)
  workspace.append(grid, world, overlay)
  if (options.view !== "canvas") shell.append(aside)
  shell.append(workspace)
  root.replaceChildren(shell)

  let sourceStore = coreEditor.getStore()
  let currentStore = previewFrame.active ? (previewStore(previewFrame) ?? sourceStore) : sourceStore

  const treeMounted: MountedComponentTree | undefined =
    options.view === "canvas"
      ? undefined
      : mountComponentTreeView(
          aside,
          coreEditor,
          {
            pageId: options.pageId,
            session,
            readOnly: isPreviewActive,
            ...(previewFrame.active
              ? { state: treeSessionState(sessionState, options.pageId), store: currentStore }
              : {}),
          },
          false,
        )

  const currentPage = currentStore.get(options.pageId)
  const canvas = createCanvasView(
    currentStore,
    currentPage?.typeName === "page" ? currentPage : initialPage,
    world,
    board,
    overlay,
  )
  const updateViewport = (): void => {
    world.style.transform = `translate(${sessionState.viewport.x}px, ${sessionState.viewport.y}px) scale(${sessionState.viewport.zoom})`
    const gridSize = 16 * sessionState.viewport.zoom
    grid.style.backgroundPosition = `${sessionState.viewport.x}px ${sessionState.viewport.y}px`
    grid.style.backgroundSize = `${gridSize}px ${gridSize}px`
    grid.hidden = !sessionState.gridVisible
  }
  updateViewport()
  renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)

  const refreshReplayBanner = (): void => {
    updateReplayBanner({ previewFrame, shell, workspace, replayBanner })
  }
  refreshReplayBanner()

  let destroyed = false

  const pointer = createPointerController({
    coreEditor,
    session,
    getSessionState: () => sessionState,
    getCurrentStore: () => currentStore,
    isPreviewActive,
    shell,
    workspace,
    board,
    overlay,
    canvas,
  })
  pointer.attach()

  const onCoreChange = (event: EditorChangeEvent): void => {
    if (destroyed) return
    sourceStore = event.store
    if (isPreviewActive()) return
    pointer.cancelActive()
    currentStore = sourceStore
    const page = currentStore.get(options.pageId)
    if (page?.typeName !== "page") return
    canvas.update(currentStore, page, canvasNeedsRebuild(event.transaction.forward))
    if (treeMounted !== undefined && treeNeedsUpdate(event.transaction.forward)) {
      treeMounted.update(currentStore, options.pageId, sessionState, true)
    }
    renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
  }
  const onSessionChange = (nextState: EditorSessionState): void => {
    if (destroyed) return
    sourceSessionState = nextState
    if (isPreviewActive()) return
    const selectionChanged = !sameArray(sessionState.selection, nextState.selection)
    const viewportChanged =
      sessionState.viewport.x !== nextState.viewport.x ||
      sessionState.viewport.y !== nextState.viewport.y ||
      sessionState.viewport.zoom !== nextState.viewport.zoom
    const gridChanged = sessionState.gridVisible !== nextState.gridVisible
    const expandedChanged = !sameArray(sessionState.expanded, nextState.expanded)
    if (pointer.isGroupResizeActive() && (selectionChanged || viewportChanged)) {
      pointer.cancelActive()
    }
    sessionState = nextState
    if (treeMounted !== undefined) {
      if (expandedChanged) treeMounted.update(currentStore, options.pageId, nextState, true)
      else if (selectionChanged) treeMounted.update(currentStore, options.pageId, nextState, false)
    }
    if (viewportChanged || gridChanged) updateViewport()
    if (selectionChanged || viewportChanged) {
      renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, nextState)
    }
  }

  const unsubscribeCore = coreEditor.subscribe(onCoreChange)
  const unsubscribeSession = session.subscribe(onSessionChange)
  const unsubscribePreview = subscribePreview({
    source: options.preview,
    isDestroyed: () => destroyed,
    cancelActiveInteraction: () => pointer.cancelActive(),
    applyFrame: (nextFrame) => {
      previewFrame = nextFrame
      sessionState = previewFrame.active
        ? (previewFrame.session ?? sourceSessionState)
        : sourceSessionState
      currentStore = previewFrame.active ? (previewStore(previewFrame) ?? sourceStore) : sourceStore
      const page = currentStore.get(options.pageId)
      if (page?.typeName !== "page") return
      canvas.update(currentStore, page, true)
      treeMounted?.update(
        currentStore,
        options.pageId,
        previewFrame.active
          ? treeSessionState(sessionState, options.pageId)
          : sourceSessionState,
        true,
      )
      updateViewport()
      renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
      refreshReplayBanner()
    },
  })

  return {
    session,
    destroy() {
      if (destroyed) return
      destroyed = true
      pointer.cancelActive()
      pointer.detach()
      treeMounted?.destroy()
      unsubscribeCore()
      unsubscribeSession()
      unsubscribePreview?.()
      shell.remove()
    },
  }
}
