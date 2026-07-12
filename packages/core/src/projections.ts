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

function buildChildrenIndex(store: RecordStore): Map<string, NodeRecord[]> {
  const childrenByParent = new Map<string, NodeRecord[]>()
  for (const record of store.all()) {
    if (record.typeName !== "node") continue
    const children = childrenByParent.get(record.parentId)
    if (children === undefined) childrenByParent.set(record.parentId, [record])
    else children.push(record)
  }

  for (const children of childrenByParent.values()) {
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted; children is new.
    children.sort((left, right) => left.index.localeCompare(right.index))
  }
  return childrenByParent
}

export function getChildren(store: RecordStore, parentId: string): NodeRecord[] {
  return buildChildrenIndex(store).get(parentId) ?? []
}

function treeItemsFromIndex(
  page: PageRecord,
  childrenByParent: ReadonlyMap<string, readonly NodeRecord[]>,
  expanded: ReadonlySet<string>,
): TreeItem[] {
  const walk = (parent: PageRecord | NodeRecord, depth: number): TreeItem[] => {
    const children = childrenByParent.get(parent.id) ?? []
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

export function getTreeItems(
  store: RecordStore,
  pageId: string,
  expanded: ReadonlySet<string>,
): TreeItem[] {
  const page = store.get(pageId)
  if (page?.typeName !== "page") return []
  return treeItemsFromIndex(page, buildChildrenIndex(store), expanded)
}
