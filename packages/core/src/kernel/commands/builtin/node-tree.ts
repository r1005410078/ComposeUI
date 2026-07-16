/**
 * @module commands/builtin/node-tree
 *
 * 节点树结构与元数据：delete / reorder / rename / visibility / lock。
 */

import type { NodeRecord } from "../../../document/schema"
import type { RecordStore } from "../../../store/store"
import type {
  CommandContribution,
  DeleteNodeCommand,
  DispatchCommand,
  RenameNodeCommand,
  ReorderNodeCommand,
  SetNodeLockedCommand,
  SetNodeVisibleCommand,
} from "../types"
import { failure, nodeResult, success } from "./helpers"

function prepareDelete(store: RecordStore, command: DeleteNodeCommand) {
  const records = new Map(store.all().map((record) => [record.id, record]))
  const childrenByParent = new Map<string, string[]>()
  for (const record of records.values()) {
    if (record.typeName !== "node") continue
    const children = childrenByParent.get(record.parentId) ?? []
    children.push(record.id)
    childrenByParent.set(record.parentId, children)
  }

  const selected = new Set<string>()
  for (const id of command.payload.ids) {
    const record = records.get(id)
    if (record?.typeName === "page") {
      return failure("PAGE_REMOVE_FORBIDDEN", "The root page cannot be removed.", id)
    }
    const result = nodeResult(store, id)
    if (!result.ok) return result
    selected.add(id)
  }

  const roots = [...selected].filter((id) => {
    let parent = records.get(id)
    if (parent?.typeName === "node") parent = records.get(parent.parentId)
    while (parent?.typeName === "node") {
      if (selected.has(parent.id)) return false
      parent = records.get(parent.parentId)
    }
    return true
  })
  const subtree: Array<{ id: string; depth: number }> = []
  for (const root of roots) {
    const pending = [{ id: root, depth: 0 }]
    while (pending.length > 0) {
      const current = pending.pop()!
      subtree.push(current)
      for (const childId of childrenByParent.get(current.id) ?? []) {
        pending.push({ id: childId, depth: current.depth + 1 })
      }
    }
  }

  // 深节点先删；数组为新建，排序不会改 Store / 命令入参
  const ids = subtree
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((left, right) => {
      const difference = right.depth - left.depth
      return difference === 0 ? left.id.localeCompare(right.id) : difference
    })
    .map((item) => item.id)
  return success((draft) => {
    for (const id of ids) draft.remove(id)
  })
}

function prepareReorder(store: RecordStore, command: ReorderNodeCommand) {
  const node = nodeResult(store, command.payload.id)
  if (!node.ok) return node
  const parent = store.get(command.payload.parentId)
  if (parent?.typeName !== "page" && parent?.typeName !== "node") {
    return failure(
      "PARENT_NOT_FOUND",
      `Parent ${command.payload.parentId} does not exist.`,
      command.payload.parentId,
    )
  }
  const occupiedSibling = store
    .all()
    .find(
      (record): record is NodeRecord =>
        record.typeName === "node" &&
        record.id !== node.value.id &&
        record.parentId === command.payload.parentId &&
        record.index === command.payload.index,
    )
  return success((draft) => {
    if (node.value.parentId === command.payload.parentId && occupiedSibling !== undefined) {
      draft.update(occupiedSibling.id, { index: node.value.index })
    }
    draft.update(command.payload.id, {
      parentId: command.payload.parentId,
      index: command.payload.index,
    })
  })
}

function prepareNodeUpdate(store: RecordStore, id: string, patch: Partial<NodeRecord>) {
  const node = nodeResult(store, id)
  if (!node.ok) return node
  return success((draft) => draft.update(id, patch))
}

export const nodeDeleteContribution: CommandContribution = {
  id: "node.delete",
  prepare(store, command: DispatchCommand) {
    return prepareDelete(store, command as DeleteNodeCommand)
  },
}

export const nodeReorderContribution: CommandContribution = {
  id: "node.reorder",
  prepare(store, command: DispatchCommand) {
    return prepareReorder(store, command as ReorderNodeCommand)
  },
}

export const nodeRenameContribution: CommandContribution = {
  id: "node.rename",
  prepare(store, command: DispatchCommand) {
    const typed = command as RenameNodeCommand
    return prepareNodeUpdate(store, typed.payload.id, { name: typed.payload.name })
  },
}

export const nodeSetVisibleContribution: CommandContribution = {
  id: "node.setVisible",
  prepare(store, command: DispatchCommand) {
    const typed = command as SetNodeVisibleCommand
    return prepareNodeUpdate(store, typed.payload.id, { visible: typed.payload.visible })
  },
}

export const nodeSetLockedContribution: CommandContribution = {
  id: "node.setLocked",
  prepare(store, command: DispatchCommand) {
    const typed = command as SetNodeLockedCommand
    return prepareNodeUpdate(store, typed.payload.id, { locked: typed.payload.locked })
  },
}
