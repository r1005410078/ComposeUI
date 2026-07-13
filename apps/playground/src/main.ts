import {
  createLocalStorageLayoutStore,
  mountEditorWorkspace,
  type StorageLike,
} from "@composeui/editor"
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

function mountPlayground(app: HTMLElement): void {
  const scenario = createM1Scenario()
  const output = document.createElement("pre")
  output.className = "playground-json-output"
  output.dataset.testid = "canonical-json-output"
  output.hidden = true

  const editorHost = document.createElement("div")
  editorHost.className = "playground-editor-host"
  app.replaceChildren(editorHost)

  const layoutStore = createPlaygroundLayoutStore(window.localStorage)
  const mounted = mountEditorWorkspace(editorHost, scenario.editor, {
    pageId: scenario.pageId,
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
          void mounted.api.resetLayout()
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
    Object.assign(window, { __composeuiM1: { editor: scenario.editor, mounted } })
  }
}

if (typeof document !== "undefined") {
  const app = document.querySelector<HTMLElement>("#app")
  if (app !== null) mountPlayground(app)
}
