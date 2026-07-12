import type { NodeRecord, PageRecord } from "./schema"
import type { RecordStore } from "./store"

export interface TreeItem {
  id: string
  depth: number
  parentId: string | null
  name: string
  typeName: "page" | "node"
  visible: boolean
  locked: boolean
  hasChildren: boolean
}

export function getChildren(store: RecordStore, parentId: string): NodeRecord[] {
  const children = store
    .all()
    .filter(
      (record): record is NodeRecord => record.typeName === "node" && record.parentId === parentId,
    )
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted; children is new.
  return children.sort((left, right) => left.index.localeCompare(right.index))
}

export function getTreeItems(
  store: RecordStore,
  pageId: string,
  expanded: ReadonlySet<string>,
): TreeItem[] {
  const page = store.get(pageId)
  if (page?.typeName !== "page") return []

  const walk = (parent: PageRecord | NodeRecord, depth: number): TreeItem[] => {
    const children = getChildren(store, parent.id)
    const item: TreeItem = {
      id: parent.id,
      depth,
      parentId: parent.typeName === "node" ? parent.parentId : null,
      name: parent.name,
      typeName: parent.typeName,
      visible: parent.typeName === "page" ? true : parent.visible,
      locked: parent.typeName === "page" ? false : parent.locked,
      hasChildren: children.length > 0,
    }

    if (!expanded.has(parent.id)) return [item]
    return [item, ...children.flatMap((child) => walk(child, depth + 1))]
  }

  return walk(page, 0)
}
