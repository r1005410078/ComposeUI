/**
 * @module diagnostics
 *
 * 结构化错误/警告与 Result 契约。
 *
 * 边界：命令、事务、History 失败不抛业务异常给 UI 解析字符串，
 * 而是返回 `Result` + `Diagnostic[]`，便于面板、operation log 与宿主统一消费。
 */

/** 单条可机器处理的诊断；code 稳定，message 面向人类。 */
export interface Diagnostic {
  code: string
  severity: "error" | "warning"
  message: string
  /** 关联 record 时填写，便于树/画布高亮。 */
  recordId?: string
}

/**
 * 统一成功/失败返回值。
 * 失败时不带 value，避免调用方误用半截状态。
 */
export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }
