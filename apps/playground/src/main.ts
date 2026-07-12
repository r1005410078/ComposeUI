import { mountEditor } from "@composeui/editor"
import "@composeui/editor/editor.css"
import { createM1Scenario } from "./m1-free-layout-scenario"
import "./styles.css"

const app = document.querySelector<HTMLElement>("#app")
if (app === null) throw new Error("PLAYGROUND_INIT_FAILED")

const scenario = createM1Scenario()
const toolbar = document.createElement("header")
toolbar.className = "playground-toolbar"

const createButton = document.createElement("button")
createButton.type = "button"
createButton.dataset.testid = "create-node"
createButton.textContent = "Create rectangle"

const gridButton = document.createElement("button")
gridButton.type = "button"
gridButton.dataset.testid = "toggle-grid"
gridButton.textContent = "Grid"
gridButton.setAttribute("aria-pressed", "true")

const exportButton = document.createElement("button")
exportButton.type = "button"
exportButton.dataset.testid = "export-json"
exportButton.textContent = "Export JSON"

const output = document.createElement("pre")
output.className = "playground-json-output"
output.dataset.testid = "canonical-json-output"
output.hidden = true

const editorHost = document.createElement("div")
editorHost.className = "playground-editor-host"
toolbar.append(createButton, gridButton, exportButton)
app.replaceChildren(toolbar, editorHost, output)

const mounted = mountEditor(editorHost, scenario.editor, { pageId: scenario.pageId })
createButton.addEventListener("click", () => scenario.createNode())
gridButton.addEventListener("click", () => {
  const visible = !mounted.session.getState().gridVisible
  mounted.session.setGridVisible(visible)
  gridButton.setAttribute("aria-pressed", String(visible))
})
exportButton.addEventListener("click", () => {
  output.textContent = scenario.exportCanonicalJson()
  output.hidden = false
})

if (import.meta.env.DEV) {
  Object.assign(window, { __composeuiM1: { editor: scenario.editor, mounted } })
}
