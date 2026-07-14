import {
  EditorSession,
  EditorSessionReplayAdapter,
  OperationLogController,
  ReplayController,
  type EditorSessionState,
  createSessionOperationObserver,
  createLocalStorageLayoutStore,
  mountEditorWorkspace,
  type StorageLike,
} from "@composeui/editor"
import { canonicalizeDocument } from "@composeui/core"
import {
  IndexedDbOperationLogStore,
  OperationLogCoordinator,
  OperationRecorder,
  createCoreOperationObserver,
  exportLogBundle,
  hashCanonical,
  importLogBundle,
  ReplayEngine,
  type ValidatedLogBundle,
} from "@composeui/operation-log"
import {
  ChevronsDownUp,
  Eye,
  FileJson,
  Plus,
  RefreshCcw,
  createElement as createIconElement,
} from "lucide"
import { createM1Scenario } from "./m1-free-layout-scenario"
import "./styles.css"

const PLAYGROUND_LAYOUT_KEY = "composeui:workspace:2d:v2"
const PLAYGROUND_LOG_DATABASE = "composeui:playground:operation-log:v1"
const PLAYGROUND_SESSION_ID = "playground-session"
const PLAYGROUND_PROJECT_ID = "bms-playground"

export interface PlaygroundOperationRuntimeOptions {
  databaseName?: string
  indexedDB?: IDBFactory
  checkpointEveryEvents?: number
  checkpointEveryMs?: number
}

export interface PlaygroundOperationRuntime {
  readonly indexedDB: IDBFactory
  readonly scenario: ReturnType<typeof createM1Scenario>
  readonly session: EditorSession
  readonly store: IndexedDbOperationLogStore
  readonly recorder: OperationRecorder
  readonly coordinator: OperationLogCoordinator
  readonly controller: OperationLogController
  readonly replayController: ReplayController
  mount(root: HTMLElement): void
  dispose(): Promise<void>
}

export async function createPlaygroundOperationRuntime(
  options: PlaygroundOperationRuntimeOptions = {},
): Promise<PlaygroundOperationRuntime> {
  const factory = options.indexedDB ?? globalThis.indexedDB
  if (factory === undefined) throw new Error("INDEXEDDB_UNAVAILABLE")
  const store = await IndexedDbOperationLogStore.open({
    databaseName: options.databaseName ?? PLAYGROUND_LOG_DATABASE,
    indexedDB: factory,
  })
  await OperationLogCoordinator.recover(store, new Date().toISOString(), {
    projectId: PLAYGROUND_PROJECT_ID,
    staleAfterMs: 0,
  })
  const existingSession = await store.getSession(PLAYGROUND_SESSION_ID)
  const recorder = new OperationRecorder({
    sessionId: PLAYGROUND_SESSION_ID,
    projectId: PLAYGROUND_PROJECT_ID,
    store,
    initialSequence: existingSession?.eventCount ?? 0,
    redactor: <T>(value: T) => structuredClone(value),
  })
  const session = new EditorSession({ operationObserver: createSessionOperationObserver(recorder) })
  let coordinator: OperationLogCoordinator | undefined
  const scenario = createM1Scenario({
    operationObserver: createCoreOperationObserver(recorder, {
      onDocumentCommandSucceeded: () => coordinator?.documentEvent(),
    }),
  })
  const initialDocument = canonicalizeDocument(scenario.editor.getStore())
  const initialSessionState = session.getState()
  await store.putCheckpoint({
    sessionId: recorder.sessionId,
    sequence: 0,
    createdAt: new Date().toISOString(),
    document: initialDocument,
    sessionState: initialSessionState,
    documentHash: await hashCanonical(initialDocument),
    sessionHash: await hashCanonical(initialSessionState),
  })
  const startedCoordinator = await OperationLogCoordinator.start({
    store,
    recorder,
    snapshot: async () => {
      const document = canonicalizeDocument(scenario.editor.getStore())
      const sessionState = session.getState()
      return {
        document,
        sessionState,
        documentHash: await hashCanonical(document),
        sessionHash: await hashCanonical(sessionState),
      }
    },
    checkpointEveryEvents: options.checkpointEveryEvents ?? 100,
    checkpointEveryMs: options.checkpointEveryMs ?? 30_000,
    lifecycle: {
      onHidden(flush) {
        if (typeof document === "undefined") return
        const listener = (): void => {
          if (document.visibilityState === "hidden") void flush().catch(() => undefined)
        }
        document.addEventListener("visibilitychange", listener)
        return () => document.removeEventListener("visibilitychange", listener)
      },
    },
  })
  coordinator = startedCoordinator
  const loadReplayBundle = async (): Promise<ValidatedLogBundle> => {
    await startedCoordinator.flush()
    const serialized = await exportLogBundle(store, {
      sessionId: recorder.sessionId,
      productVersion: "playground-replay",
      redactor: <T>(value: T) => structuredClone(value),
      redactionPolicy: "replay-v1",
    })
    return importLogBundle(serialized)
  }
  const replayController = new ReplayController({
    createEngine: async (targetSequence) => {
      const bundle = await loadReplayBundle()
      return ReplayEngine.create({
        bundle,
        targetSequence,
        createSession: (initialState) => {
          const isolatedSession = new EditorSession()
          const adapter = new EditorSessionReplayAdapter(isolatedSession)
          const state = initialState as EditorSessionState
          adapter.setSelection(state.selection)
          adapter.setViewport(state.viewport)
          adapter.setInteractionMode(state.interactionMode)
          adapter.setGridVisible(state.gridVisible)
          adapter.setExpanded(state.expanded)
          return adapter
        },
      })
    },
  })
  const controller = new OperationLogController({
    store,
    sessionId: recorder.sessionId,
    startReplay: (sequence) => replayController.start(sequence).then(() => undefined),
    exportSession: () =>
      exportLogBundle(store, {
        sessionId: recorder.sessionId,
        productVersion: "playground",
      }),
    replayController,
  })
  let mounted: ReturnType<typeof mountEditorWorkspace> | undefined
  let disposed = false
  return {
    indexedDB: factory,
    scenario,
    session,
    store,
    recorder,
    coordinator: startedCoordinator,
    controller,
    replayController,
    mount(root) {
      mounted = mountEditorWorkspace(root, scenario.editor, {
        pageId: scenario.pageId,
        projectTitle: "BMS",
        session,
        operationLog: controller,
      })
    },
    async dispose() {
      if (disposed) return
      disposed = true
      mounted?.dispose()
      mounted = undefined
      controller.dispose()
      try {
        await startedCoordinator.end()
        await startedCoordinator.flush()
      } catch {
        // Closing the store is still required after a failed final flush.
      } finally {
        await store.close().catch(() => undefined)
      }
    },
  }
}

export function createPlaygroundLayoutStore(storage: StorageLike) {
  return createLocalStorageLayoutStore(storage, PLAYGROUND_LAYOUT_KEY)
}

function createIconCommandButton(
  testId: string,
  label: string,
  icon: Parameters<typeof createIconElement>[0],
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "playground-icon-command"
  button.dataset.testid = testId
  button.title = label
  button.setAttribute("aria-label", label)
  button.append(createIconElement(icon))
  button.addEventListener("click", onClick)
  return button
}

async function mountPlayground(app: HTMLElement): Promise<void> {
  const runtime = await createPlaygroundOperationRuntime()
  const { scenario } = runtime
  const output = document.createElement("pre")
  output.className = "playground-json-output"
  output.dataset.testid = "canonical-json-output"
  output.hidden = true

  const editorHost = document.createElement("div")
  editorHost.className = "playground-editor-host"
  app.replaceChildren(editorHost)

  const layoutStore = createPlaygroundLayoutStore(window.localStorage)
  const workspace = mountEditorWorkspace(editorHost, scenario.editor, {
    pageId: scenario.pageId,
    session: runtime.session,
    operationLog: runtime.controller,
    projectTitle: "BMS",
    layoutStore,
    mountSceneExtras(sceneRoot) {
      const treePanel = sceneRoot.querySelector<HTMLElement>(".composeui-editor__component-tree")
      if (treePanel === null) throw new Error("PLAYGROUND_SCENE_TREE_MISSING")
      const commands = document.createElement("div")
      commands.className = "playground-scene-command-group"
      const createNode = createIconCommandButton("create-node", "创建节点", Plus, () => {
        scenario.createNode()
      })
      const search = document.createElement("input")
      search.type = "search"
      search.className = "playground-node-search"
      search.dataset.testid = "node-search"
      search.placeholder = "检索节点"
      search.setAttribute("aria-label", "检索节点")
      const collapseAll = createIconCommandButton(
        "collapse-all",
        "全部折叠",
        ChevronsDownUp,
        () => {
          const expanded = treePanel.querySelector<HTMLButtonElement>(
            "[data-tree-control='toggle'][aria-expanded='true']",
          )
          const selector =
            expanded === null
              ? "[data-tree-control='toggle'][aria-expanded='false']"
              : "[data-tree-control='toggle'][aria-expanded='true']"
          while (true) {
            const toggle = treePanel.querySelector<HTMLButtonElement>(selector)
            if (toggle === null) break
            toggle.click()
          }
          const nextLabel = expanded === null ? "全部折叠" : "全部展开"
          collapseAll.title = nextLabel
          collapseAll.setAttribute("aria-label", nextLabel)
        },
      )
      const applySearch = (): void => {
        const query = search.value.trim().toLocaleLowerCase()
        for (const row of treePanel.querySelectorAll<HTMLElement>("[data-testid^='tree-row-']")) {
          const item = row.closest<HTMLElement>("[role='treeitem']")
          const select = row.querySelector<HTMLElement>("[data-tree-control='select']")
          if (item === null || select === null) continue
          const isPage = row.dataset.treeId === scenario.pageId
          item.hidden = !isPage && !select.textContent?.toLocaleLowerCase().includes(query)
        }
      }
      search.addEventListener("input", applySearch)
      const unsubscribeSearch = scenario.editor.subscribe(applySearch)
      commands.append(createNode, search, collapseAll)
      treePanel.prepend(commands)
      applySearch()
      return () => {
        unsubscribeSearch()
        commands.remove()
      }
    },
    mountToolbarExtras(toolbar) {
      const tools = toolbar.querySelector<HTMLElement>(".composeui-editor__toolbar-group")
      if (tools === null) throw new Error("PLAYGROUND_TOOL_GROUP_MISSING")

      const gridButton = toolbar.querySelector<HTMLButtonElement>(
        "[data-testid='workspace-tool-grid']",
      )
      if (gridButton === null) throw new Error("PLAYGROUND_GRID_BUTTON_MISSING")
      gridButton.dataset.testid = "toggle-grid"

      const commands = document.createElement("div")
      commands.className = "playground-command-group"
      const overflowButton = createIconCommandButton(
        "toggle-page-overflow",
        "显示画布外内容",
        Eye,
        () => {
          const page = scenario.editor.getRecord(scenario.pageId)
          if (page?.typeName !== "page") return
          scenario.editor.dispatch({
            id: "page.setOverflow",
            payload: {
              id: page.id,
              overflow: page.overflow === "visible" ? "hidden" : "visible",
            },
          })
        },
      )
      const syncOverflowButton = (): void => {
        const page = scenario.editor.getRecord(scenario.pageId)
        overflowButton.setAttribute(
          "aria-pressed",
          String(page?.typeName === "page" && page.overflow === "visible"),
        )
      }
      overflowButton.setAttribute("aria-pressed", "true")
      commands.append(
        overflowButton,
        createIconCommandButton("export-json", "导出 JSON", FileJson, () => {
          output.textContent = scenario.exportCanonicalJson()
          output.hidden = false
        }),
        createIconCommandButton("reset-layout", "重置布局", RefreshCcw, () => {
          void workspace.api.resetLayout()
        }),
      )
      tools.append(commands)
      const unsubscribe = scenario.editor.subscribe(syncOverflowButton)
      syncOverflowButton()
      return () => {
        unsubscribe()
        commands.remove()
      }
    },
  })
  editorHost.append(output)

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __composeuiM1: { editor: scenario.editor, mounted: workspace, operationRuntime: runtime },
    })
  }
  window.addEventListener("pagehide", () => void runtime.dispose().catch(() => undefined), {
    once: true,
  })
}

if (typeof document !== "undefined") {
  const app = document.querySelector<HTMLElement>("#app")
  if (app !== null) void mountPlayground(app)
}
