const UNSUPPORTED_CANONICAL_VALUE = "UNSUPPORTED_CANONICAL_VALUE"

const unsupported = (): never => {
  throw new Error(UNSUPPORTED_CANONICAL_VALUE)
}

export const canonicalJson = (value: unknown): string => {
  const active = new Set<object>()

  const serialize = (current: unknown): string => {
    if (current === null) return "null"
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current)
    }
    if (typeof current === "number") {
      return Number.isFinite(current) ? JSON.stringify(current) : unsupported()
    }
    if (typeof current !== "object") return unsupported()
    if (active.has(current)) return unsupported()

    active.add(current)
    try {
      if (Array.isArray(current)) {
        return `[${current.map(serialize).join(",")}]`
      }

      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) return unsupported()

      const object = current as Record<string, unknown>
      return `{${Object.keys(object)
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted.
        .sort((left, right) => left.localeCompare(right))
        .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
        .join(",")}}`
    } finally {
      active.delete(current)
    }
  }

  return serialize(value)
}

export const hashCanonical = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
