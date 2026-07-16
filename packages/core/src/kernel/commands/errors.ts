/**
 * @module commands/errors
 *
 * Editor 构造/插件安装期失败。
 *
 * 与运行时 `Result` + Diagnostic 区分：初始化失败直接 throw，
 * 调用方不得把半安装的 Editor 当作可用实例。
 * `code` 是机器契约；`message` 仅供人类阅读。
 */

/** 插件 id 冲突、命令 id 冲突或插件 register 抛错时抛出。 */
export class EditorInitializationError extends Error {
  readonly code: "PLUGIN_ID_CONFLICT" | "COMMAND_ID_CONFLICT" | "PLUGIN_INSTALL_FAILED"

  constructor(
    code: EditorInitializationError["code"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = "EditorInitializationError"
    this.code = code
  }
}
