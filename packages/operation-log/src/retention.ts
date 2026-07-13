import type { OperationLifecycleStore } from "./store"

export const DEFAULT_RETENTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_RETENTION_MAX_BYTES = 50 * 1024 * 1024

export interface OperationRetentionOptions {
  now?: Date | number | string
  maxAgeMs?: number
  maxBytes?: number
  projectId?: string
}

export interface OperationRetentionResult {
  deletedSessionIds: string[]
  usageBytes: number
}

export async function enforceRetention(
  store: OperationLifecycleStore,
  options: OperationRetentionOptions = {},
): Promise<OperationRetentionResult> {
  const now = toTimestamp(options.now ?? Date.now())
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_RETENTION_MAX_AGE_MS
  const maxBytes = options.maxBytes ?? DEFAULT_RETENTION_MAX_BYTES
  validateLimit(maxAgeMs, "maxAgeMs")
  validateLimit(maxBytes, "maxBytes")

  const sessions = await store.listSessions(options.projectId)
  const completed = sessions
    .filter((session) => session.status === "ended" && session.endedAt !== undefined)
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
    .sort((left, right) => {
      const byEndedAt = compareStrings(left.endedAt!, right.endedAt!)
      return byEndedAt || compareStrings(left.sessionId, right.sessionId)
    })
  const newestCompleteSessionId = completed.at(-1)?.sessionId
  const cutoff = now - maxAgeMs
  let usageBytes = await store.estimateUsage()
  const deletedSessionIds: string[] = []

  for (const session of completed) {
    if (session.sessionId === newestCompleteSessionId) continue

    const ageExpired = toTimestamp(session.endedAt!) < cutoff
    const overBytes = usageBytes > maxBytes
    if (!ageExpired && !overBytes) break

    await store.deleteSession(session.sessionId)
    deletedSessionIds.push(session.sessionId)
    usageBytes = await store.estimateUsage()
  }

  return { deletedSessionIds, usageBytes }
}

function toTimestamp(value: Date | number | string): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(timestamp)) throw new Error("INVALID_RETENTION_DATE")
  return timestamp
}

function validateLimit(value: number, name: string): void {
  if (value < 0 || Number.isNaN(value)) throw new Error(`INVALID_RETENTION_${name}`)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
