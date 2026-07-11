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
}

export interface NodeRecord extends BaseRecord {
  typeName: "node"
  nodeType: "rectangle"
  parentId: string
  index: string
  props: { x: number; y: number; width: number; height: number; fill: string }
}

export type EditorRecord = DocumentRecord | PageRecord | NodeRecord

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
      },
    ],
  }
}
