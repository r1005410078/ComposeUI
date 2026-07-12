import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  canonicalizeDocument,
  createEditor,
  createEmptyDocument,
  type NodeRecord,
} from "@composeui/core"

const PROPERTY_SEED = 20_260_712

const operationArbitrary = fc.oneof(
  fc.record({
    type: fc.constant("move" as const),
    node: fc.nat(),
    dx: fc.integer({ min: -10, max: 10 }).filter((value) => value !== 0),
    dy: fc.integer({ min: -10, max: 10 }).filter((value) => value !== 0),
  }),
  fc.record({ type: fc.constant("delete" as const), node: fc.nat() }),
  fc.record({
    type: fc.constant("reparent" as const),
    node: fc.nat(),
    parent: fc.nat(),
  }),
)

type TestEditor = ReturnType<typeof createEditor>

function nodesIn(editor: TestEditor): NodeRecord[] {
  return editor
    .getStore()
    .all()
    .filter((record): record is NodeRecord => record.typeName === "node")
}

function assertTreeInvariants(editor: TestEditor): void {
  const store = editor.getStore()
  const siblingIndexes = new Map<string, Set<string>>()

  for (const node of nodesIn(editor)) {
    const parent = store.get(node.parentId)
    expect(parent?.typeName === "page" || parent?.typeName === "node").toBe(true)
    expect(node.parentId).not.toBe(node.id)

    const indexes = siblingIndexes.get(node.parentId) ?? new Set<string>()
    expect(indexes.has(node.index)).toBe(false)
    indexes.add(node.index)
    siblingIndexes.set(node.parentId, indexes)

    const ancestors = new Set([node.id])
    let current = node
    while (true) {
      const currentParent = store.get(current.parentId)
      expect(currentParent).toBeDefined()
      if (currentParent?.typeName === "page") {
        expect(currentParent.id).toBe("page-1")
        break
      }
      expect(currentParent?.typeName).toBe("node")
      if (currentParent?.typeName !== "node") break
      expect(ancestors.has(currentParent.id)).toBe(false)
      ancestors.add(currentParent.id)
      current = currentParent
    }
  }
}

function createNode(editor: TestEditor, id: string, parentId: string): void {
  expect(
    editor.dispatch({
      id: "node.create",
      payload: {
        id,
        parentId,
        name: id,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fill: "#000000",
      },
    }).ok,
  ).toBe(true)
}

function createNestedTree(editor: TestEditor): void {
  createNode(editor, "parent-a", "page-1")
  createNode(editor, "child-a", "parent-a")
  createNode(editor, "grandchild-a", "child-a")
  createNode(editor, "sibling-a", "parent-a")
  createNode(editor, "parent-b", "page-1")
  createNode(editor, "child-b", "parent-b")
}

function descendantsOf(editor: TestEditor, rootId: string): Set<string> {
  const descendants = new Set<string>()
  let found = true
  while (found) {
    found = false
    for (const node of nodesIn(editor)) {
      if (descendants.has(node.id)) continue
      if (node.parentId === rootId || descendants.has(node.parentId)) {
        descendants.add(node.id)
        found = true
      }
    }
  }
  return descendants
}

function deleteAndRestore(editor: TestEditor, id: string, subtreeIds: string[]): void {
  const beforeDelete = canonicalizeDocument(editor.getStore())
  expect(editor.dispatch({ id: "node.delete", payload: { ids: [id] } }).ok).toBe(true)
  for (const subtreeId of subtreeIds) expect(editor.getRecord(subtreeId)).toBeUndefined()
  assertTreeInvariants(editor)

  expect(editor.undo().ok).toBe(true)
  expect(canonicalizeDocument(editor.getStore())).toEqual(beforeDelete)
  assertTreeInvariants(editor)
}

describe("M1 command invariants", () => {
  it("preserves a valid nested tree through move, delete, and reparent sequences", () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { minLength: 1, maxLength: 30 }), (steps) => {
        const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
        createNestedTree(editor)
        assertTreeInvariants(editor)

        deleteAndRestore(editor, "child-a", ["child-a", "grandchild-a"])
        deleteAndRestore(editor, "parent-a", ["parent-a", "child-a", "grandchild-a", "sibling-a"])

        for (const [stepIndex, step] of steps.entries()) {
          const currentNodes = nodesIn(editor)
          const selected = currentNodes[step.node % currentNodes.length]!

          if (step.type === "move") {
            expect(
              editor.dispatch({
                id: "node.move",
                payload: { ids: [selected.id], delta: { x: step.dx, y: step.dy } },
              }).ok,
            ).toBe(true)
          } else if (step.type === "delete") {
            const beforeDelete = canonicalizeDocument(editor.getStore())
            expect(editor.dispatch({ id: "node.delete", payload: { ids: [selected.id] } }).ok).toBe(
              true,
            )
            assertTreeInvariants(editor)
            if (nodesIn(editor).length === 0) {
              expect(editor.undo().ok).toBe(true)
              expect(canonicalizeDocument(editor.getStore())).toEqual(beforeDelete)
            }
          } else {
            const descendants = descendantsOf(editor, selected.id)
            const legalParents = [
              "page-1",
              ...currentNodes
                .filter((node) => node.id !== selected.id && !descendants.has(node.id))
                .map((node) => node.id),
            ]
            const parentId = legalParents[step.parent % legalParents.length]!
            expect(
              editor.dispatch({
                id: "node.reorder",
                payload: { id: selected.id, parentId, index: `p${stepIndex}` },
              }).ok,
            ).toBe(true)
          }

          assertTreeInvariants(editor)
        }
      }),
      { seed: PROPERTY_SEED, numRuns: 100 },
    )
  })
})
