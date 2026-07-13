import { describe, expect, it } from "vitest"
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
})
