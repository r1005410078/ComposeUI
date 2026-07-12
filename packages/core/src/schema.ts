export interface BaseRecord {
  id: string
  revision: number
}

export interface DocumentRecord extends BaseRecord {
  typeName: "document"
  schemaVersion: 1
  rootPageId: string
}

export interface PageRecord extends BaseRecord {
  typeName: "page"
  name: string
  width: number
  height: number
  background: string
  overflow: "visible" | "hidden" | "scroll"
  layout: { mode: "free" }
}

export interface FreeLayout {
  mode: "free"
  x: number
  y: number
  width: number
  height: number
}

export interface NodeRecord extends BaseRecord {
  typeName: "node"
  nodeType: "rectangle"
  name: string
  parentId: string
  index: string
  layout: FreeLayout
  visible: boolean
  locked: boolean
  props: { fill: string }
}

export type PersistentRecord = DocumentRecord | PageRecord | NodeRecord
export type EditorRecord = PersistentRecord
export type RecordUpdatePatch<T extends PersistentRecord["typeName"]> = Partial<
  Omit<Extract<PersistentRecord, { typeName: T }>, "id" | "typeName" | "revision">
>

export interface PageDocument {
  schemaVersion: 1
  rootPageId: string
  records: EditorRecord[]
}

export function createEmptyDocument(input: { documentId: string; pageId: string }): PageDocument {
  return {
    schemaVersion: 1,
    rootPageId: input.pageId,
    records: [
      {
        id: input.documentId,
        revision: 0,
        typeName: "document",
        schemaVersion: 1,
        rootPageId: input.pageId,
      },
      {
        id: input.pageId,
        revision: 0,
        typeName: "page",
        name: "Page 1",
        width: 1440,
        height: 900,
        background: "#ffffff",
        overflow: "visible",
        layout: { mode: "free" },
      },
    ],
  }
}
