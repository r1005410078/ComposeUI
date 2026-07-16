/**
 * @module mount
 *
 * 画布与可选组合壳的 DOM 挂载装配：shell、Canvas 网格底景、board、overlay、pointer、preview。
 *
 * 架构分层：
 * - Document：core Editor + RecordStore（节点几何与属性）
 * - Session：viewport / selection / grid / pan 模式（不入文档）
 * - 预览：EditorPreviewSource 可覆盖展示用 document/session（回放只读预览）
 *
 * 数据流：mountEditor → 订阅 editor + session → 重绘 board / workspace-canvas；交互 → dispatch。
 */

import type { Editor, EditorChangeEvent } from "@composeui/core"
import { mountComponentTreeView, treeNeedsUpdate } from "../tree/component-tree"
import type { MountedComponentTree } from "../tree/component-tree"
import { screenToWorld } from "../session/coordinates"
import { EditorSession } from "../session/session"
import type { EditorSessionState } from "../session/session"
import { createCanvasView, canvasNeedsRebuild } from "./board-render"
import { SVG_NAMESPACE, renderSelectionOverlay } from "./overlay"
import { createPointerController } from "./pointer"
import { workspacePoint } from "./pointer-helpers"
import {
  previewStore,
  subscribePreview,
  treeSessionState,
  updateReplayBanner,
  type EditorPreviewFrame,
  type EditorPreviewSource,
} from "./preview"
import { createWorkspaceCanvas } from "./workspace-canvas"

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
  const workspaceCanvas = createWorkspaceCanvas()
  const replayBanner = document.createElement("div")
  replayBanner.dataset.testid = "replay-canvas-banner"
  replayBanner.setAttribute("role", "status")

  world.append(board)
  workspace.append(workspaceCanvas.element, world, overlay)
  if (options.view !== "canvas") shell.append(aside)
  shell.append(workspace)
  root.replaceChildren(shell)

  let sourceStore = coreEditor.getStore()
  let currentStore = previewFrame.active ? (previewStore(previewFrame) ?? sourceStore) : sourceStore
  let cursorWorld: { x: number; y: number } | null = null

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

  // 缓存 CSS 尺寸 / DPR：避免每次 wheel/pointer 触发 getBoundingClientRect 强制布局
  let canvasCssWidth = 0
  let canvasCssHeight = 0
  let canvasDpr = 1
  let paintRaf = 0
  let paintViewport = false
  let paintOverlay = false
  let paintCanvas = false

  const measureWorkspaceSize = (): void => {
    const rect = workspace.getBoundingClientRect()
    // jsdom 等无布局环境可能给 0；用 client 尺寸兜底
    canvasCssWidth = rect.width > 0 ? rect.width : workspace.clientWidth
    canvasCssHeight = rect.height > 0 ? rect.height : workspace.clientHeight
    const nextDpr =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1
    canvasDpr = nextDpr > 0 ? nextDpr : 1
  }

  const applyWorldTransform = (): void => {
    const { x, y, zoom } = sessionState.viewport
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
  }

  const redrawWorkspaceCanvas = (): void => {
    if (canvasCssWidth <= 0 || canvasCssHeight <= 0) measureWorkspaceSize()
    workspaceCanvas.setSize(canvasCssWidth, canvasCssHeight, canvasDpr)
    workspaceCanvas.redraw({
      viewport: sessionState.viewport,
      gridVisible: sessionState.gridVisible,
      gridSize: sessionState.gridSize,
      cursorWorld,
      showRulers: true,
    })
  }

  const flushPaint = (): void => {
    paintRaf = 0
    if (destroyed) return
    if (paintViewport) {
      paintViewport = false
      applyWorldTransform()
    }
    if (paintCanvas) {
      paintCanvas = false
      redrawWorkspaceCanvas()
    }
    if (paintOverlay) {
      paintOverlay = false
      renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
    }
  }

  /** pan/zoom/指针游标等高频路径合并到下一帧，避免每条 wheel 同步全量重绘掉帧。 */
  const schedulePaint = (flags: {
    viewport?: boolean
    canvas?: boolean
    overlay?: boolean
  }): void => {
    if (flags.viewport) paintViewport = true
    if (flags.canvas) paintCanvas = true
    if (flags.overlay) paintOverlay = true
    if (paintRaf !== 0) return
    if (typeof requestAnimationFrame === "undefined") {
      flushPaint()
      return
    }
    paintRaf = requestAnimationFrame(flushPaint)
  }

  const updateViewport = (): void => {
    // 同步应用 transform 供本帧内指针坐标换算一致；canvas/overlay 可 rAF 合并
    applyWorldTransform()
    schedulePaint({ canvas: true, overlay: true })
  }

  measureWorkspaceSize()
  applyWorldTransform()
  redrawWorkspaceCanvas()
  renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)

  let destroyed = false

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (destroyed) return
          measureWorkspaceSize()
          schedulePaint({ canvas: true })
        })
      : null
  resizeObserver?.observe(workspace)

  const onWorkspacePointerMove = (event: PointerEvent): void => {
    if (destroyed) return
    const point = workspacePoint(event, workspace)
    cursorWorld = screenToWorld(point, sessionState.viewport)
    // 仅游标读数变化：合并到 rAF，不与布局测量捆绑
    schedulePaint({ canvas: true })
  }
  const onWorkspacePointerLeave = (): void => {
    if (destroyed) return
    if (cursorWorld === null) return
    cursorWorld = null
    schedulePaint({ canvas: true })
  }
  workspace.addEventListener("pointermove", onWorkspacePointerMove)
  workspace.addEventListener("pointerleave", onWorkspacePointerLeave)

  const refreshReplayBanner = (): void => {
    updateReplayBanner({ previewFrame, shell, workspace, replayBanner })
  }
  refreshReplayBanner()

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
    const gridChanged =
      sessionState.gridVisible !== nextState.gridVisible ||
      sessionState.gridSize !== nextState.gridSize
    const expandedChanged = !sameArray(sessionState.expanded, nextState.expanded)
    if (pointer.isGroupResizeActive() && (selectionChanged || viewportChanged)) {
      pointer.cancelActive()
    }
    sessionState = nextState
    if (treeMounted !== undefined) {
      if (expandedChanged) treeMounted.update(currentStore, options.pageId, nextState, true)
      else if (selectionChanged) treeMounted.update(currentStore, options.pageId, nextState, false)
    }
    if (viewportChanged) {
      // transform 立即更新（指针/滚轮同一事件栈内坐标一致）；重绘走 rAF
      applyWorldTransform()
      schedulePaint({ canvas: true, overlay: true })
    } else if (gridChanged) {
      schedulePaint({ canvas: true })
    }
    if (selectionChanged) {
      // 选区变更低频且需立刻出现 resize 手柄，同步画 overlay（不走 rAF）
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
        previewFrame.active ? treeSessionState(sessionState, options.pageId) : sourceSessionState,
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
      if (paintRaf !== 0 && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(paintRaf)
        paintRaf = 0
      }
      pointer.cancelActive()
      pointer.detach()
      treeMounted?.destroy()
      unsubscribeCore()
      unsubscribeSession()
      unsubscribePreview?.()
      resizeObserver?.disconnect()
      workspace.removeEventListener("pointermove", onWorkspacePointerMove)
      workspace.removeEventListener("pointerleave", onWorkspacePointerLeave)
      workspaceCanvas.destroy()
      shell.remove()
    },
  }
}
