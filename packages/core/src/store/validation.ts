/**
 * @module validation
 *
 * 跨 record 策略与结构比较工具。
 *
 * 数据流：事务 commit 前 / Store 装载时调用 `validateNodeTree`；
 * `deepEqual` 用于 patch 前置条件与“业务值是否变化”判断。
 *
 * 不依赖 UI；不修改入参。
 */

import type { Diagnostic } from "../shared/diagnostics"
import type { PersistentRecord } from "../document/schema"

/**
 * 深度值相等（支持数组与普通对象）。
 * 用于 revision 无关的业务 diff、patch precondition，以及 history 相关比较。
 */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => deepEqual(value, right[index]))
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  const rightKeySet = new Set(rightKeys)
  if (!leftKeys.every((key) => rightKeySet.has(key))) return false
  return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]))
}

/**
 * 校验节点树跨 record 不变量。
 *
 * 检查项：
 * - parentId 存在且为 page 或 node
 * - 作为 parent 的 page 必须是文档 root page（M1 单 page）
 * - 禁止自引用与祖先环
 * - 同 parent 下 index 唯一
 *
 * 返回诊断列表，不抛异常；调用方决定是否拒绝事务。
 */
export function validateNodeTree(
  records: ReadonlyMap<string, PersistentRecord>,
  rootPageId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const siblingIndexes = new Map<string, Set<string>>()
  const nodes = [...records.values()].filter(
    (record): record is Extract<PersistentRecord, { typeName: "node" }> =>
      record.typeName === "node",
  )
  // 0 未访问 / 1 路径中 / 2 已完成 —— 经典 DFS 着色检环
  const colors = new Map<string, 0 | 1 | 2>()

  for (const record of nodes) {
    if (record.parentId === record.id) {
      diagnostics.push({
        code: "NODE_SELF_PARENT",
        severity: "error",
        message: "A node cannot be its own parent.",
        recordId: record.id,
      })
      colors.set(record.id, 2)
      continue
    }

    const parent = records.get(record.parentId)
    if (parent?.typeName !== "page" && parent?.typeName !== "node") {
      diagnostics.push({
        code: "NODE_PARENT_NOT_FOUND",
        severity: "error",
        message: "Node parentId must identify a page or node record.",
        recordId: record.id,
      })
      colors.set(record.id, 2)
      continue
    }
    if (parent.typeName === "page" && parent.id !== rootPageId) {
      diagnostics.push({
        code: "PARENT_NOT_ROOT_PAGE",
        severity: "error",
        message: "A node parent page must be the document root page.",
        recordId: record.id,
      })
      colors.set(record.id, 2)
      continue
    }

    const indexes = siblingIndexes.get(record.parentId) ?? new Set<string>()
    if (indexes.has(record.index)) {
      diagnostics.push({
        code: "SIBLING_INDEX_CONFLICT",
        severity: "error",
        message: "Sibling node indexes must be unique.",
        recordId: record.id,
      })
    }
    indexes.add(record.index)
    siblingIndexes.set(record.parentId, indexes)
  }

  for (const record of nodes) {
    if (colors.get(record.id) === 2) continue
    const path: string[] = []
    let current: Extract<PersistentRecord, { typeName: "node" }> | undefined = record
    while (current !== undefined && colors.get(current.id) !== 2) {
      if (colors.get(current.id) === 1) {
        diagnostics.push({
          code: "NODE_PARENT_CYCLE",
          severity: "error",
          message: "Node parent relationships must be acyclic.",
          recordId: current.id,
        })
        break
      }
      colors.set(current.id, 1)
      path.push(current.id)
      const parent = records.get(current.parentId)
      current = parent?.typeName === "node" ? parent : undefined
    }
    for (const id of path) colors.set(id, 2)
  }

  return diagnostics
}
