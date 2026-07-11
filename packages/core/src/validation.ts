import type { Diagnostic } from "./diagnostics"
import type { PersistentRecord } from "./schema"

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
