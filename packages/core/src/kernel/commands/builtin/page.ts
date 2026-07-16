/**
 * @module commands/builtin/page
 *
 * 页面级命令：`page.setOverflow`。
 */

import type { RecordStore } from "../../../store/store"
import type { CommandContribution, DispatchCommand, SetPageOverflowCommand } from "../types"
import { failure, pageResult, success, validOverflow } from "./helpers"

function prepareSetPageOverflow(store: RecordStore, command: SetPageOverflowCommand) {
  const page = pageResult(store, command.payload.id)
  if (!page.ok) return page
  if (!validOverflow(command.payload.overflow)) {
    return failure(
      "INVALID_PAGE_OVERFLOW",
      "Page overflow must be visible, hidden, or scroll.",
      command.payload.id,
    )
  }
  return success((draft) =>
    draft.update(command.payload.id, { overflow: command.payload.overflow }),
  )
}

export const pageSetOverflowContribution: CommandContribution = {
  id: "page.setOverflow",
  prepare(store, command: DispatchCommand) {
    return prepareSetPageOverflow(store, command as SetPageOverflowCommand)
  },
}
