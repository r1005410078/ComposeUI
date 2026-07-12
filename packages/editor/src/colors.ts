const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i

export function safeColor(value: string, fallback: string): string {
  return HEX_COLOR.test(value.trim()) ? value.trim() : fallback
}
