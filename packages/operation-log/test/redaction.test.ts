import { describe, expect, it } from "vitest"
import { defaultRedactor } from "@composeui/operation-log"

describe("defaultRedactor", () => {
  it("redacts sensitive keys, strips URL query and hash, and preserves safe values", () => {
    const input = {
      node: "Card",
      position: { x: 10, y: 20 },
      size: { width: 100, height: 40 },
      authorization: "Bearer secret",
      nested: { apiToken: "secret", password: "pw", secretValue: "hidden" },
      url: "/x?token=secret#section",
    }

    expect(defaultRedactor(input)).toEqual({
      node: "Card",
      position: { x: 10, y: 20 },
      size: { width: 100, height: 40 },
      authorization: "[REDACTED]",
      nested: { apiToken: "[REDACTED]", password: "[REDACTED]", secretValue: "[REDACTED]" },
      url: "/x",
    })
    expect(input.authorization).toBe("Bearer secret")
    expect(input.url).toBe("/x?token=secret#section")
  })

  it("clones arrays and does not mutate the source", () => {
    const input = [{ name: "Button", token: "secret" }]
    const result = defaultRedactor(input)

    expect(result).toEqual([{ name: "Button", token: "[REDACTED]" }])
    expect(result).not.toBe(input)
    expect(input).toEqual([{ name: "Button", token: "secret" }])
  })

  it("rejects cyclic payloads with a stable error", () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(() => defaultRedactor(cyclic)).toThrow("UNSERIALIZABLE_OPERATION_PAYLOAD")
  })
})
