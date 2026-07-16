/**
 * @module query/tree
 *
 * 组件树只读投影：深度优先扁平列表与子节点查询。
 *
 * 边界：
 * - 不修改 Store，不产生事务。
 * - 展开状态 `expanded` 来自 Session，不进 PageDocument。
 * - UI 应订阅窄投影结果，而不是每次手扫全量 records（后续可做增量失效）。
 *
 * 数据流：RecordStore + session.expanded → TreeItem[] → 组件树面板。
 */

import type { NodeRecord, PageRecord } from "../document/schema"
import type { RecordStore } from "../store/store"

/** 组件树一行：深度优先展开后的扁平项。 */
export interface TreeItem {
  id: string
  depth: number
  /** page 根为 null；node 为其 parentId。 */
  parentId: string | null
  name: string
  typeName: "page" | "node"
  visible: boolean
  locked: boolean
  hasChildren: boolean
}

/** 按 parentId 建子节点索引，同级按 index 字典序。 */
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

/** 返回某 parent 下按 index 排序的直接子节点（拷贝自 store 读路径）。 */
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
      // page 无 visible/locked 字段；投影给 UI 固定可编辑外观
      visible: parent.typeName === "page" ? true : parent.visible,
      locked: parent.typeName === "page" ? false : parent.locked,
      hasChildren: children.length > 0,
    }

    // 未展开：只返回自身，子树由 UI 按需请求或下次展开后重算
    if (!expanded.has(parent.id)) return [item]
    return [item, ...children.flatMap((child) => walk(child, depth + 1))]
  }

  return walk(page, 0)
}

/**
 * 生成组件树扁平列表。
 * pageId 无效时返回空数组（不抛），避免坏会话态打挂面板。
 */
export function getTreeItems(
  store: RecordStore,
  pageId: string,
  expanded: ReadonlySet<string>,
): TreeItem[] {
  const page = store.get(pageId)
  if (page?.typeName !== "page") return []
  return treeItemsFromIndex(page, buildChildrenIndex(store), expanded)
}
