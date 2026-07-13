let fallbackCounter = 0

/** Generates IDs without requiring a Node-only or browser-only dependency. */
export const createOperationId = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID
  if (randomUuid !== undefined) return randomUuid.call(globalThis.crypto)

  const counter = (fallbackCounter++).toString(36)
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2)
  return `op-${timestamp}-${random}-${counter}`
}
