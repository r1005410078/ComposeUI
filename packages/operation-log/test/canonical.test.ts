import { describe, expect, it, vi } from "vitest"
import { canonicalJson, hashCanonical } from "@composeui/operation-log"

describe("canonicalJson", () => {
  it("serializes approved primitive, array, and object values deterministically", () => {
    expect(canonicalJson(null)).toBe("null")
    expect(canonicalJson("text")).toBe('"text"')
    expect(canonicalJson(true)).toBe("true")
    expect(canonicalJson(1.5)).toBe("1.5")
    expect(canonicalJson(["x", 2, false])).toBe('["x",2,false]')
    expect(canonicalJson({ z: 3, a: 1 })).toBe('{"a":1,"z":3}')
    expect(canonicalJson({ b: { z: 2, a: 1 }, a: [3, null] })).toBe(
      '{"a":[3,null],"b":{"a":1,"z":2}}',
    )
  })

  it("rejects unsupported and non-finite values with stable errors", () => {
    expect(() => canonicalJson(undefined)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
    expect(() => canonicalJson(1n)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
    expect(() => canonicalJson(() => undefined)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
    expect(() => canonicalJson(Symbol("value"))).toThrow("UNSUPPORTED_CANONICAL_VALUE")
    expect(() => canonicalJson(Number.NaN)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow("UNSUPPORTED_CANONICAL_VALUE")

    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
  })

  it("sorts keys by deterministic UTF-16 order regardless of locale", () => {
    const value = { ä: 1, "😀": 2, z: 3 }

    expect(canonicalJson(value)).toBe('{"z":3,"ä":1,"😀":2}')
  })

  it("rejects symbol keys instead of silently dropping them", () => {
    const symbolKey = Symbol("key")
    const value = { visible: 1, [symbolKey]: 2 }

    expect(() => canonicalJson(value)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
  })

  it("rejects sparse arrays", () => {
    const sparse: unknown[] = []
    sparse.length = 2
    expect(() => canonicalJson(sparse)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
  })

  it("rejects arrays with extra ordinary properties", () => {
    const array = [1] as number[] & { metadata?: number }
    array.metadata = 2

    expect(() => canonicalJson(array)).toThrow("UNSUPPORTED_CANONICAL_VALUE")
  })
})

describe("hashCanonical", () => {
  it("hashes equivalent key orders identically and different values differently", async () => {
    const first = await hashCanonical({ b: 2, a: 1 })
    const same = await hashCanonical({ a: 1, b: 2 })
    const different = await hashCanonical({ a: 1, b: 3 })

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(same)
    expect(first).not.toBe(different)
  })

  it("works when no global crypto provider is available", async () => {
    const value = { stable: true }
    const expected = await hashCanonical(value)

    vi.stubGlobal("crypto", undefined)
    try {
      await expect(hashCanonical(value)).resolves.toBe(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
