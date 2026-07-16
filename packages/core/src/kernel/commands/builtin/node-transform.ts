/**
 * @module commands/builtin/node-transform
 *
 * 节点几何变换：`node.move` / `node.resize` / `node.resizeMany`。
 * 锁屏障与顶层筛选语义与历史 prepare 保持一致。
 */

import type { NodeRecord } from "../../../document/schema"
import type { RecordStore } from "../../../store/store"
import type {
  CommandContribution,
  DispatchCommand,
  MoveNodeCommand,
  ResizeManyNodeCommand,
  ResizeNodeCommand,
} from "../types"
import { failure, lockedTransformBarrier, nodeResult, success, validSize } from "./helpers"

function prepareMove(store: RecordStore, command: MoveNodeCommand) {
  const nodes: NodeRecord[] = []
  const selected = new Set(command.payload.ids)
  for (const id of selected) {
    const result = nodeResult(store, id)
    if (!result.ok) return result
    const locked = lockedTransformBarrier(store, result.value)
    if (locked !== undefined) {
      return failure("NODE_LOCKED", `Node ${locked.id} is locked.`, locked.id)
    }
    if (!validSize(result.value.layout.width, result.value.layout.height)) {
      return failure("INVALID_FREE_LAYOUT_SIZE", "Free Layout dimensions must be at least 1.", id)
    }
    nodes.push(result.value)
  }

  // 父子同选时只移动祖先，子节点随父布局保留相对坐标
  const topLevelNodes = nodes.filter((node) => {
    let parent = store.get(node.parentId)
    while (parent?.typeName === "node") {
      if (selected.has(parent.id)) return false
      parent = store.get(parent.parentId)
    }
    return true
  })

  return success((draft) => {
    for (const node of topLevelNodes) {
      draft.update(node.id, {
        layout: {
          ...node.layout,
          x: node.layout.x + command.payload.delta.x,
          y: node.layout.y + command.payload.delta.y,
        },
      })
    }
  })
}

function prepareResize(store: RecordStore, command: ResizeNodeCommand) {
  const result = nodeResult(store, command.payload.id)
  if (!result.ok) return result
  const locked = lockedTransformBarrier(store, result.value)
  if (locked !== undefined) {
    return failure("NODE_LOCKED", `Node ${locked.id} is locked.`, locked.id)
  }
  if (!validSize(command.payload.width, command.payload.height)) {
    return failure(
      "INVALID_FREE_LAYOUT_SIZE",
      "Free Layout dimensions must be finite numbers greater than or equal to 1.",
      command.payload.id,
    )
  }
  const x = command.payload.x ?? result.value.layout.x
  const y = command.payload.y ?? result.value.layout.y
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return failure(
      "INVALID_FREE_LAYOUT_POSITION",
      "Free Layout positions must be finite numbers.",
      command.payload.id,
    )
  }
  return success((draft) =>
    draft.update(command.payload.id, {
      layout: {
        ...result.value.layout,
        x,
        y,
        width: command.payload.width,
        height: command.payload.height,
      },
    }),
  )
}

function prepareResizeMany(store: RecordStore, command: ResizeManyNodeCommand) {
  if (command.payload.items.length < 2) {
    return failure("INVALID_RESIZE_MANY_ITEMS", "Multi-resize requires at least two unique nodes.")
  }

  const ids = new Set<string>()
  const nodes = new Map<string, NodeRecord>()
  let parentId: string | undefined
  for (const item of command.payload.items) {
    if (ids.has(item.id)) {
      return failure(
        "DUPLICATE_RESIZE_MANY_NODE",
        `Node ${item.id} appears more than once.`,
        item.id,
      )
    }
    ids.add(item.id)

    const result = nodeResult(store, item.id)
    if (!result.ok) return result
    const locked = lockedTransformBarrier(store, result.value)
    if (locked !== undefined) {
      return failure("NODE_LOCKED", `Node ${locked.id} is locked.`, locked.id)
    }
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      return failure(
        "INVALID_FREE_LAYOUT_POSITION",
        "Free Layout positions must be finite numbers.",
        item.id,
      )
    }
    if (!validSize(item.width, item.height)) {
      return failure(
        "INVALID_FREE_LAYOUT_SIZE",
        "Free Layout dimensions must be finite numbers greater than or equal to 1.",
        item.id,
      )
    }
    if (parentId === undefined) {
      parentId = result.value.parentId
    } else if (result.value.parentId !== parentId) {
      return failure(
        "RESIZE_MANY_PARENT_MISMATCH",
        "Multi-resize nodes must share the same parent.",
        item.id,
      )
    }
    nodes.set(item.id, result.value)
  }

  return success((draft) => {
    for (const item of command.payload.items) {
      const node = nodes.get(item.id)!
      draft.update(item.id, {
        layout: {
          ...node.layout,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
      })
    }
  })
}

export const nodeMoveContribution: CommandContribution = {
  id: "node.move",
  prepare(store, command: DispatchCommand) {
    return prepareMove(store, command as MoveNodeCommand)
  },
}

export const nodeResizeContribution: CommandContribution = {
  id: "node.resize",
  prepare(store, command: DispatchCommand) {
    return prepareResize(store, command as ResizeNodeCommand)
  },
}

export const nodeResizeManyContribution: CommandContribution = {
  id: "node.resizeMany",
  prepare(store, command: DispatchCommand) {
    return prepareResizeMany(store, command as ResizeManyNodeCommand)
  },
}
