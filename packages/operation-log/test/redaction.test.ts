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

  it("strips query and hash from protocol-relative and hash-only URLs", () => {
    expect(
      defaultRedactor({
        asset: "//cdn.example.test/path?token=secret#section",
        fragment: "#section",
        ordinary: "hello?world#section",
      }),
    ).toEqual({
      asset: "//cdn.example.test/path",
      fragment: "",
      ordinary: "hello?world#section",
    })
  })

  it("strips query-bearing mailto, data, query-only, and bare host/path values", () => {
    expect(
      defaultRedactor({
        queryOnly: "?token=secret",
        mailto: "mailto:person@example.test?subject=hello#section",
        data: "data:text/plain,hello?token=secret#section",
        barePath: "cdn.example.test/assets/icon.svg?token=secret#section",
        ordinary: "hello?world#section",
      }),
    ).toEqual({
      queryOnly: "",
      mailto: "mailto:person@example.test",
      data: "data:text/plain,hello",
      barePath: "cdn.example.test/assets/icon.svg",
      ordinary: "hello?world#section",
    })
  })

  it("rejects sparse arrays", () => {
    const sparse: unknown[] = []
    sparse.length = 2

    expect(() => defaultRedactor(sparse)).toThrow("UNSERIALIZABLE_OPERATION_PAYLOAD")
  })

  it("rejects cyclic payloads with a stable error", () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(() => defaultRedactor(cyclic)).toThrow("UNSERIALIZABLE_OPERATION_PAYLOAD")
  })
})
