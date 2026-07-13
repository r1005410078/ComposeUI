import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import type { EditorOperationObserver } from "@composeui/core"

export function createM1Scenario(options: { operationObserver?: EditorOperationObserver } = {}) {
  const pageId = "page-1"
  const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId }), options)
  editor.dispatch({
    id: "node.create",
    payload: {
      id: "node-red",
      parentId: pageId,
      name: "Red rectangle",
      x: 80,
      y: 72,
      width: 240,
      height: 160,
      fill: "#dc2626",
    },
  })
  editor.dispatch({
    id: "node.create",
    payload: {
      id: "node-blue",
      parentId: pageId,
      name: "Blue rectangle",
      x: 380,
      y: 240,
      width: 280,
      height: 180,
      fill: "#2563eb",
    },
  })
  let createdCount = 0
  const createNode = () => {
    createdCount += 1
    const offset = (createdCount - 1) * 24
    return editor.dispatch({
      id: "node.create",
      payload: {
        id: `node-created-${createdCount}`,
        parentId: pageId,
        name: `Rectangle ${createdCount}`,
        x: 120 + offset,
        y: 120 + offset,
        width: 180,
        height: 120,
        fill: "#16a34a",
      },
    })
  }
  const exportCanonicalJson = () =>
    `${JSON.stringify(canonicalizeDocument(editor.getStore()), null, 2)}\n`

  return { editor, pageId, createNode, exportCanonicalJson }
}
