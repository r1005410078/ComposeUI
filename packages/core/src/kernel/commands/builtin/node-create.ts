/**
 * @module commands/builtin/node-create
 *
 * `node.create`：在 parent 下创建 free-layout rectangle。
 */

import type { NodeRecord } from "../../../document/schema"
import type { RecordStore } from "../../../store/store"
import type { CommandContribution, CreateNodeCommand, DispatchCommand } from "../types"
import { failure, nextSiblingIndex, success, validSize } from "./helpers"

function prepareCreate(store: RecordStore, command: CreateNodeCommand) {
  const parent = store.get(command.payload.parentId)
  if (parent?.typeName !== "page" && parent?.typeName !== "node") {
    return failure(
      "PARENT_NOT_FOUND",
      `Parent ${command.payload.parentId} does not exist.`,
      command.payload.parentId,
    )
  }
  if (!validSize(command.payload.width, command.payload.height)) {
    return failure(
      "INVALID_FREE_LAYOUT_SIZE",
      "Free Layout dimensions must be finite numbers greater than or equal to 1.",
      command.payload.id,
    )
  }

  const node: NodeRecord = {
    id: command.payload.id,
    revision: 0,
    typeName: "node",
    nodeType: "rectangle",
    name: command.payload.name,
    parentId: command.payload.parentId,
    index: nextSiblingIndex(store, command.payload.parentId),
    layout: {
      mode: "free",
      x: command.payload.x,
      y: command.payload.y,
      width: command.payload.width,
      height: command.payload.height,
    },
    visible: true,
    locked: false,
    props: { fill: command.payload.fill },
  }
  return success((draft) => draft.create(node))
}

export const nodeCreateContribution: CommandContribution = {
  id: "node.create",
  prepare(store, command: DispatchCommand) {
    return prepareCreate(store, command as CreateNodeCommand)
  },
}
