/**
 * @module colors
 *
 * 画布/主题用的安全色解析：只接受 hex，拒绝 url()/脚本注入式字符串。
 * 非法输入回落 fallback，避免把用户或导入数据直接塞进 CSS。
 */

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i

/** 校验 hex 颜色；不通过则返回 fallback。 */
export function safeColor(value: string, fallback: string): string {
  return HEX_COLOR.test(value.trim()) ? value.trim() : fallback
}
