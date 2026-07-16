/**
 * @module workspace/output-value-format
 *
 * 将任意 payload 安全格式化为 Output 面板可读文本。
 * 处理 bigint、循环引用与 JSON 失败，避免详情区抛错。
 */

/** 序列化未知值；失败返回占位中文串。 */
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
