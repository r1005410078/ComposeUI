export interface Diagnostic {
  code: string
  severity: "error" | "warning"
  message: string
  recordId?: string
}

export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }
