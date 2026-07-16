/**
 * @module commands/types
 *
 * Command 插件贡献点与开放 dispatch 信封的类型契约。
 *
 * 边界：
 * - `prepare` 只读 store，产出 draft mutator；不得直接 mutate store / 调用 transact
 * - `DispatchCommand` 是 registry、dispatch、operation observer 的最小公共形状
 *
 * 数据流：CommandPlugin.register → CommandPluginApi.registerCommand → dispatch(id)
 */

import type { Result } from "../../shared/diagnostics"
import type { RecordStore } from "../../store/store"
import type { TransactionDraft } from "../transaction"

/** 稳定命令 id，如 `"node.move"`。 */
export type CommandId = string

/**
 * 开放命令信封：builtin 与宿主插件命令共用的最小形状。
 * 具体 payload 由各 contribution 在 prepare 内收窄。
 */
export interface DispatchCommand {
  id: CommandId
  payload?: unknown
}

/**
 * 一条可注册的文档命令贡献。
 * prepare 失败返回 Result.ok=false；成功返回 draft 变更函数，由 Editor 在 transact 中执行。
 */
export interface CommandContribution {
  id: CommandId
  prepare(
    store: RecordStore,
    command: DispatchCommand,
  ): Result<(draft: TransactionDraft) => void>
  /** 可选：history 标签 / 日志展示 */
  label?: string
}

/**
 * 插件安装时拿到的注册 API；作用域属于当前插件，便于回滚与统一 dispose。
 */
export interface CommandPluginApi {
  registerCommand(contribution: CommandContribution): () => void
}

/**
 * 文档命令插件：向 API 注册零个或多个 CommandContribution。
 * 可返回 dispose；也可依赖 Editor 级 dispose 统一卸载。
 */
export interface CommandPlugin {
  id: string
  register(api: CommandPluginApi): void | (() => void)
}
