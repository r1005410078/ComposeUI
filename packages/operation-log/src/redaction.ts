const SENSITIVE_KEY = /authorization|token|password|secret/i

const isUrlLike = (value: string): boolean =>
  value.startsWith("/") ||
  value.startsWith("./") ||
  value.startsWith("../") ||
  value.startsWith("#") ||
  /^[a-z][a-z\d+.-]*:\/\//i.test(value)

const redactUrl = (value: string): string => {
  if (!isUrlLike(value)) return value
  const queryStart = value.search(/[?#]/)
  return queryStart === -1 ? value : value.slice(0, queryStart)
}

export const defaultRedactor = <T>(value: T): T => {
  const active = new Set<object>()

  const redact = (current: unknown, key?: string): unknown => {
    if (key !== undefined && SENSITIVE_KEY.test(key)) return "[REDACTED]"
    if (typeof current === "string") return redactUrl(current)
    if (current === null || typeof current !== "object") return current
    if (active.has(current)) throw new Error("UNSERIALIZABLE_OPERATION_PAYLOAD")

    active.add(current)
    try {
      if (Array.isArray(current)) return current.map((item) => redact(item))
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("UNSERIALIZABLE_OPERATION_PAYLOAD")
      }
      return Object.fromEntries(
        Object.entries(current).map(([entryKey, entryValue]) => [
          entryKey,
          redact(entryValue, entryKey),
        ]),
      )
    } finally {
      active.delete(current)
    }
  }

  return redact(value) as T
}
