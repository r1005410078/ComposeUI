import type { Diagnostic, Result } from "./diagnostics"
import type { NodeRecord, PageDocument } from "./schema"
import { RecordStore } from "./store"
import { transact } from "./transaction"

export interface CreateNodeCommand {
  id: "node.create"
  payload: {
    id: string
    parentId: string
    x: number
    y: number
    width: number
    height: number
    fill: string
  }
}

export type EditorCommand = CreateNodeCommand

export interface Editor {
  dispatch(command: EditorCommand): Result<void>
  getRecord(id: string): ReturnType<RecordStore["get"]>
  getStore(): RecordStore
}

export function createEditor(document: PageDocument): Editor {
  let store = RecordStore.fromDocument(document)

  return {
    dispatch(command) {
      const parent = store.get(command.payload.parentId)
      if (parent?.typeName !== "page" && parent?.typeName !== "node") {
        const diagnostic: Diagnostic = {
          code: "PARENT_NOT_FOUND",
          severity: "error",
          message: `Parent ${command.payload.parentId} does not exist.`,
          recordId: command.payload.parentId,
        }
        return { ok: false, diagnostics: [diagnostic] }
      }

      const node: NodeRecord = {
        id: command.payload.id,
        revision: 0,
        typeName: "node",
        nodeType: "rectangle",
        parentId: command.payload.parentId,
        index: "a0",
        props: {
          x: command.payload.x,
          y: command.payload.y,
          width: command.payload.width,
          height: command.payload.height,
          fill: command.payload.fill,
        },
      }
      const result = transact(store, { kind: "local-command", commandId: command.id }, (tx) => {
        tx.create(node)
      })
      if (!result.ok) return { ok: false, diagnostics: result.diagnostics }
      store = result.store
      return { ok: true, value: undefined, diagnostics: [] }
    },
    getRecord: (id) => store.get(id),
    getStore: () => store,
  }
}
