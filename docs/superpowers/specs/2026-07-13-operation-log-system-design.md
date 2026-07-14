# 操作日志系统设计

## 目标

为 ComposeUI 增加持久化操作日志系统，使每个有意义的编辑器交互都可以在之后被检查、确定性回放，并用于定位实际行为第一次偏离预期的位置。

Output 面板作为面向用户的操作控制台。日志独立于项目文档保存，并可以导出为独立的诊断包。

## 当前状态

- 第一阶段已完成：事件契约、Recorder、规范化哈希、内存与 IndexedDB 持久化、检查点、保留策略、日志导入导出、Output 控制台和隔离确定性回放。
- 第一阶段已通过 Vitest、TypeScript 类型检查、Lint、构建和 Playwright 回放 E2E 验证，并已合并到 `main`。
- 第二阶段尚未完成：完整 Workspace 布局日志、高频交互采样与合并、导入日志管理增强和连续视觉回放。

## 设计决策

- 刷新后仍在本地保留日志。
- 捕获文档、历史、会话、Workspace、诊断以及部分高频交互事件。
- 优先保证状态确定性回放，而不是像素级指针回放。
- 将日志导出为独立包，而不是嵌入项目文档。
- 将语义命令作为回放输入，将事务补丁和状态哈希作为校验输出。
- 保持实现与框架无关，使同一服务可以注入 React、Vue 2、Vue 3、Angular 或直接 DOM 宿主。

## 与 History 的关系

操作日志不会替代现有的 `History` 时间线。

`History` 负责当前可编辑的撤销/重做分支。向后跳转后再发出新命令，可能会从 History 中丢弃被放弃的未来分支。

操作日志是对已发生操作的追加记录。撤销、重做、历史跳转、失败命令以及被放弃的分支都会保留在日志中。History 条目和操作事件通过 `transactionId` 关联。

## 包与依赖边界

创建框架无关的 `@composeui/operation-log` 包，承担四项主要职责：

- `OperationRecorder` 接收规范化事件，分配顺序和因果元数据，执行脱敏与合并，并发布查询更新。
- `OperationLogStore` 定义持久化端口，并提供内存和 IndexedDB 适配器。
- `ReplayEngine` 在隔离运行时中恢复检查点、回放事件并报告确定性差异。
- `LogBundleCodec` 校验、迁移、导入和导出独立日志包。

集成边界应使用窄事件 sink，而不是让业务模块直接依赖存储：

- `@composeui/core` 声明窄化的 `EditorOperationObserver` 端口，通过它发出命令尝试、成功、失败、撤销、重做和历史跳转事件。
- editor session 发出选择、当前工具、视口和树展开状态变化。
- Workspace 发出面板激活、布局变化、恢复失败和面板失败事件。
- Output 订阅 operation-log 查询 API，不直接访问 IndexedDB。
- 框架适配器负责创建和注入同一个 operation-log 服务，但不实现日志规则。

依赖方向保持单向：`@composeui/operation-log` 可以依赖公开的 core 类型并实现 core observer 端口，但 core 永远不能导入 operation-log 包。Core 必须继续能够在 Node.js 中使用和测试，也不能依赖浏览器持久化适配器。

## 事件模型

每个事件都使用带版本的 envelope：

```ts
interface OperationEvent<TPayload> {
  schemaVersion: 1
  eventId: string
  sessionId: string
  projectId: string
  sequence: number
  timestamp: string
  category: "document" | "history" | "session" | "workspace" | "diagnostic" | "system"
  type: string
  status: "observed" | "started" | "succeeded" | "failed"
  transactionId?: string
  causationId?: string
  payload: TPayload
  diagnostics?: Diagnostic[]
  beforeHash?: string
  afterHash?: string
}
```

`sequence` 在一个 session 内严格递增，是权威的回放顺序。墙上时钟时间只用于展示，不能用于排序。

初始事件族包括：

- `document.command`：命令 ID 和结构化 payload；成功事件包含正向与逆向补丁以及前后状态哈希。
- `history.undo`、`history.redo` 和 `history.jump`：目标事务和时间线位置。
- `session.selection`、`session.tool`、`session.viewport` 和 `session.treeDisclosure`：编辑器会话状态变化。
- `workspace.panel` 和 `workspace.layout`：面板激活、移动、折叠和恢复。
- `diagnostic.reported`：命令校验、监听器、持久化、回放和面板失败。
- `system.sessionStarted`、`system.checkpoint` 和 `system.sessionEnded`：生命周期与回放边界。

命令尝试必须在准备和事务执行前记录，从而保留失败操作。成功命令事件包含原始命令、生成的补丁、事务 ID 和哈希。失败命令事件包含经过脱敏的命令和结构化诊断信息。

所有 payload 必须支持 structured clone 并可序列化。禁止保存 DOM 节点、函数、循环引用和未经处理的原始异常对象。

## 因果关系与幂等性

每个事件都有全局唯一的 `eventId`。重试必须保留同一个 ID，使存储层能够拒绝重复事件。

`causationId` 用于关联派生事件和触发事件。例如，一次指针拖动可以触发 `document.command`，随后产生事务和 Output 更新。`transactionId` 将命令与 History 关联，但不让 History 成为事件源。

Recorder 失败不能递归产生无限诊断事件链。内部持久化失败使用受保护且限流的诊断通道，并在超过限制后进入终止性 degraded 状态。

## 高频事件

文档命令不能被采样或丢弃。

指针移动、视口平移、缩放和拖拽预览可能产生大量事件。Recorder 保留交互开始和结束事件，在可配置的时间窗口内合并中间值，并记录最终精确状态。合并事件保留输入数量和时间范围，使 Output 可以显示类似 `画布平移 28 次` 的摘要。

确定性文档回放依赖最终语义命令，而不是中间指针采样。

## 隐私与脱敏

可配置的 redactor 在持久化和导出前运行。默认策略保留回放所需的节点 ID、名称、尺寸、坐标、命令 payload、补丁和诊断信息。

默认策略删除或遮盖凭据、授权数据、URL 查询参数、未经批准的项目相对路径之外的本地文件路径、资源内容以及宿主提供的敏感元数据。

数据进入 IndexedDB 前必须先脱敏。导出时再次执行脱敏，使宿主可以采用比本地策略更严格的共享策略。

## 规范化哈希

状态哈希根据规范化文档表示计算：

- 对象键使用确定性排序。
- 记录使用稳定的 identity 排序。
- 不支持的值必须被拒绝，不能隐式转成字符串。
- 会话和 Workspace 状态与项目文档分开计算哈希。
- 哈希算法和规范化版本写入 bundle manifest。

哈希比较可以低成本检测分歧。补丁比较则生成可供人阅读的字段级差异。

## 持久化

默认浏览器适配器使用 IndexedDB，并包含四个 object store：

- `sessions`：session 元数据、项目 ID、产品版本、开始/结束时间、事件数量和最终哈希。
- `events`：以 `[sessionId, sequence]` 为键的追加事件，并建立 Output 筛选所需的索引。
- `checkpoints`：以 session 和 sequence 为键的文档与会话快照。
- `metadata`：数据库 schema 版本、迁移状态和存储统计信息。

文档命令结果、失败、撤销、重做和历史跳转等关键事件立即排队。普通 UI 事件可以短批次写入，但必须保持已分配的 sequence 顺序。

页面进入 hidden、项目切换和 Workspace 正常销毁时，适配器都会 flush 待写批次。浏览器关闭不保证执行清理，因此下次启动时会检测未关闭的 session，并标记为异常结束。

IndexedDB 失败不能阻塞编辑。Recorder 重试临时失败；超过重试预算后进入 degraded 状态；在可能的情况下保留有界的内存尾部，并在 Output 中显示诊断信息。

## 检查点与保留策略

满足以下任一条件时创建检查点：累计 100 个文档事件，或距离上一个检查点达到 30 秒。两个阈值都由宿主配置。

每个检查点保存完整的规范化文档快照、回放所需的会话状态、sequence 和哈希。检查点之后的事件仍保持追加模式。

默认本地保留策略为每个项目 50 MB 或 30 天。清理优先删除最早结束的 session，同时保留当前 session、当前 session 最近的有效检查点和最近一个完整 session。已导出的 bundle 不受本地保留策略影响。

## 日志包

独立日志包包含：

- 带版本的 manifest。
- 产品、schema、哈希、浏览器、平台、插件和功能版本。
- 初始快照及后续检查点。
- 按顺序排列的操作事件。
- 脱敏策略元数据和完整性哈希。

导入时必须校验 bundle 大小、schema 支持情况、sequence 连续性、事件 identity、检查点哈希、哈希链完整性以及支持的命令/事件类型，校验通过后才能开放回放。

导入数据不可信。它不能包含可执行 handler，不能执行任意代码，不能访问当前项目，不能发起网络请求，也不能通过宿主资源适配器写入数据。

## 确定性回放

回放始终在隔离的 editor 实例中运行，绝不会修改当前项目。

为了到达目标事件，ReplayEngine 会：

1. 校验 bundle 和环境元数据。
2. 选择目标事件之前最近的有效检查点。
3. 创建隔离的 core、session 和 Workspace 状态。
4. 按 sequence 顺序执行文档命令和历史操作。
5. 在每个确定性事件之后比较命令结果、诊断、补丁和状态哈希。
6. 应用可回放的 session 与 Workspace 事件。
7. 在目标位置暂停，并暴露重建后的状态和事件上下文。

支持单步、回放到事件、连续播放和 headless 验证模式。连续播放可以使用原始相对时间或固定速度。Headless 验证在第一次不一致处停止。

回放会禁用保存、网络请求、上传、外部资源修改以及其他宿主副作用。

## 回放差异

回放报告带类型的差异：

- `command-mismatch`：成功、失败或诊断信息不同。
- `patch-mismatch`：受影响的记录或字段不同。
- `state-hash-mismatch`：规范化后的最终状态不同。
- `missing-handler`：当前运行时无法识别某个事件。
- `schema-incompatible`：bundle 无法安全迁移。
- `environment-mismatch`：产品、插件或功能版本不匹配。

默认行为是在第一次差异处暂停，并显示预期值、实际值、首次不同字段和相邻事件。用户可以继续使用 best-effort 模式，但之后所有结果都必须标记为非确定性。

## Output 面板

Output 面板使用现有主题 token 和颜色，作为紧凑的操作控制台。

工具栏包含：

- 清空当前视图，但不删除已持久化事件。
- 操作、信息、警告和错误级别筛选。
- 文档、历史、会话、Workspace 和诊断类别筛选。
- 按命令 ID、节点名称、事务 ID 和诊断代码进行文本搜索。
- 自动滚动开关。
- 导入、导出和回放操作。

每一行虚拟化日志显示时间、状态图标、本地化摘要和关键参数，例如移动操作的坐标变化与缩放操作的尺寸变化。失败事件显示诊断代码和错误状态。合并的 UI 事件以一个可展开分组显示。

选择日志行后，结构化详情会显示 payload、补丁、哈希、事务 ID、因果关系和诊断信息。详情视图支持复制单个事件，并从该事件开始回放。

本地化摘要来自 formatter registry。持久化事件保存语义数据，而不是翻译后的展示字符串，因此切换语言不需要迁移日志。

## 错误处理

- 日志和持久化错误不能使编辑器命令失败。
- 事件订阅者彼此隔离，一个错误订阅者不能阻塞其他订阅者。
- 存储重试必须保留 `eventId` 和 sequence 顺序。
- Quota 和迁移错误必须在 Output 中可见，并可通过诊断 API 获取。
- 无效导入 bundle 必须 fail closed，并且不能提供给 ReplayEngine。
- 未知的新事件可以作为原始结构化数据展示，但没有注册 handler 时不能参与确定性回放。

## 交付阶段

### 第一阶段：已完成

- 事件契约、Recorder、规范化哈希和内存存储。
- 文档命令成功/失败、撤销、重做和历史跳转捕获。
- 选择、当前工具和视口捕获。
- IndexedDB 持久化、检查点、保留策略和导出。
- Output 筛选、搜索、详情和虚拟化列表。
- 隔离单步、回放到事件和 headless 确定性回放。

### 第二阶段

- [x] Workspace 面板和布局捕获。
- [x] Workspace 持久化与向后兼容的 bundle。
- [x] 隔离 Workspace 回放。
- [ ] 更高频交互采样。
- [ ] 导入 bundle 管理界面。
- [ ] 连续视觉回放。

## 测试

单元测试覆盖事件顺序、幂等性、合并、脱敏、规范化哈希、存储重试、保留策略和 schema 迁移。

Core 集成测试覆盖每种命令的成功与失败场景、事务关联、补丁与哈希，以及不改变现有 History 行为的撤销/重做/跳转事件。

回放测试证明原始文档和重建文档一致，并证明修改命令、补丁、哈希、sequence 或检查点时会产生预期的类型化差异。

IndexedDB 测试覆盖刷新恢复、中断批次、Quota 失败、重复重试、清理和数据库升级。

Editor 测试覆盖 Output 筛选、搜索、详情、本地化 formatter、虚拟滚动、导入错误和 degraded 状态诊断。

端到端测试执行创建、移动、缩放、重命名、撤销、重做和历史跳转；刷新应用；重新加载持久化日志；并完成确定性回放。

性能测试验证普通命令记录不会在交互路径中增加同步存储工作，并且高频 UI 输入会被合并，而不是逐事件持久化。

## 非目标

- 替代现有的撤销/重做 History 实现。
- 将操作历史嵌入项目文档。
- 将操作日志作为协作协议。
- 记录截图、视频或每一个原始指针事件。
- 保证不同产品或插件版本之间的精确视觉回放。
- 在第一阶段将日志上传到服务器。
- 允许回放触发宿主副作用。
