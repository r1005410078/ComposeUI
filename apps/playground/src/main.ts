import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import "./styles.css"

const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
editor.dispatch({
  id: "node.create",
  payload: {
    id: "node-1",
    parentId: "page-1",
    x: 40,
    y: 40,
    width: 160,
    height: 100,
    fill: "#2563eb",
  },
})

const pageDocument = canonicalizeDocument(editor.getStore())
const node = pageDocument.records.find((record) => record.id === "node-1")
const app = document.querySelector<HTMLElement>("#app")
if (app === null || node?.typeName !== "node") throw new Error("PLAYGROUND_INIT_FAILED")

app.innerHTML = `
  <header><strong>ComposeUI</strong><span>M0 Core Loop</span></header>
  <section aria-label="Page board" class="page-board">
    <div data-node-id="${node.id}" class="node"></div>
  </section>
  <pre aria-label="Page document"></pre>
`

const renderedNode = app.querySelector<HTMLElement>("[data-node-id='node-1']")
const output = app.querySelector<HTMLElement>("pre")
if (renderedNode === null || output === null) throw new Error("PLAYGROUND_RENDER_FAILED")
Object.assign(renderedNode.style, {
  left: `${node.props.x}px`,
  top: `${node.props.y}px`,
  width: `${node.props.width}px`,
  height: `${node.props.height}px`,
  background: node.props.fill,
})
output.textContent = JSON.stringify(pageDocument, null, 2)
