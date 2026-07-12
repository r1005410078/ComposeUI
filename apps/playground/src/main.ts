import {
  createLocalStorageLayoutStore,
  mountEditorWorkspace,
  type StorageLike,
} from "@composeui/editor"
import { createM1Scenario } from "./m1-free-layout-scenario"
import "./styles.css"

const PLAYGROUND_LAYOUT_KEY = "composeui:workspace:2d:v1"

export function createPlaygroundLayoutStore(storage: StorageLike) {
  return createLocalStorageLayoutStore(storage, PLAYGROUND_LAYOUT_KEY)
}

function createCommandButton(
  testId: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "playground-command"
  button.dataset.testid = testId
  button.textContent = label
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
  app.replaceChildren(editorHost, output)

  const layoutStore = createPlaygroundLayoutStore(window.localStorage)
  const mounted = mountEditorWorkspace(editorHost, scenario.editor, {
    pageId: scenario.pageId,
    layoutStore,
  })

  const toolbar = editorHost.querySelector<HTMLElement>(".composeui-editor__toolbar")
  if (toolbar === null) throw new Error("PLAYGROUND_TOOLBAR_MISSING")
  const tools = toolbar.querySelector<HTMLElement>(".composeui-editor__toolbar-group")
  if (tools === null) throw new Error("PLAYGROUND_TOOL_GROUP_MISSING")

  const gridButton = toolbar.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-grid']")
  if (gridButton === null) throw new Error("PLAYGROUND_GRID_BUTTON_MISSING")
  gridButton.dataset.testid = "toggle-grid"

  const commands = document.createElement("div")
  commands.className = "playground-command-group"
  const syncOverflowButton = (): void => {
    const page = scenario.editor.getRecord(scenario.pageId)
    overflowButton.setAttribute(
      "aria-pressed",
      String(page?.typeName === "page" && page.overflow === "visible"),
    )
  }
  const overflowButton = createCommandButton("toggle-page-overflow", "Show outside canvas", () => {
    const page = scenario.editor.getRecord(scenario.pageId)
    if (page?.typeName !== "page") return
    scenario.editor.dispatch({
      id: "page.setOverflow",
      payload: {
        id: page.id,
        overflow: page.overflow === "visible" ? "hidden" : "visible",
      },
    })
  })
  overflowButton.setAttribute("aria-pressed", "true")
  commands.append(
    createCommandButton("create-node", "Create rectangle", () => scenario.createNode()),
    overflowButton,
    createCommandButton("export-json", "Export JSON", () => {
      output.textContent = scenario.exportCanonicalJson()
      output.hidden = false
    }),
    createCommandButton("reset-layout", "Reset layout", () => {
      void mounted.api.resetLayout()
    }),
  )
  const panelMenu = toolbar.querySelector<HTMLElement>(".composeui-editor__panel-menu")
  if (panelMenu === null) throw new Error("PLAYGROUND_PANEL_MENU_MISSING")
  window.setTimeout(() => {
    tools.append(commands)
  }, 0)

  scenario.editor.subscribe(syncOverflowButton)
  syncOverflowButton()

  if (import.meta.env.DEV) {
    Object.assign(window, { __composeuiM1: { editor: scenario.editor, mounted } })
  }
}

if (typeof document !== "undefined") {
  const app = document.querySelector<HTMLElement>("#app")
  if (app !== null) mountPlayground(app)
}
