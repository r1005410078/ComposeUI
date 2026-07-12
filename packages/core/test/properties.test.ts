import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"

const PROPERTY_SEED = 20_260_712

describe("M1 command invariants", () => {
  it("never produces dangling parents after valid move and delete sequences", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("move", "delete"), { minLength: 1, maxLength: 30 }),
        (steps) => {
          const editor = createEditor(
            createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
          )
          expect(
            editor.dispatch({
              id: "node.create",
              payload: {
                id: "node-1",
                parentId: "page-1",
                name: "Card",
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                fill: "#000000",
              },
            }).ok,
          ).toBe(true)

          for (const step of steps) {
            if (editor.getRecord("node-1") === undefined) continue
            const result =
              step === "move"
                ? editor.dispatch({
                    id: "node.move",
                    payload: { ids: ["node-1"], delta: { x: 1, y: 1 } },
                  })
                : editor.dispatch({ id: "node.delete", payload: { ids: ["node-1"] } })
            expect(result.ok).toBe(true)
          }

          for (const record of editor.getStore().all()) {
            if (record.typeName === "node") {
              expect(editor.getStore().get(record.parentId)).toBeDefined()
            }
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: 100 },
    )
  })
})
