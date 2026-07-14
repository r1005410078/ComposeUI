export function safeText(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return `${item.toString()}n`
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[循环引用]"
        seen.add(item)
      }
      return item
    })
    return serialized ?? String(value)
  } catch {
    return "[无法显示]"
  }
}
