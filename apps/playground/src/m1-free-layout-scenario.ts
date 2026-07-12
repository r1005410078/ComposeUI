import { createEditor, createEmptyDocument } from "@composeui/core"

export function createM1Scenario() {
  const pageId = "page-1"
  const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId }))
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
  return { editor, pageId }
}
