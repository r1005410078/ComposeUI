# Dockview 编辑器工作区设计

## 目标

使用 Dockview 构建正式的 ComposeUI 编辑器工作区，布局参考 Godot，并保留现有无框架 TypeScript/DOM 编辑器内核。第一阶段只提供 2D 工作区，包含场景树、资源、历史、画布、画布工具栏、Inspector，以及底部工具面板。

工作区必须能够被 React、Vue 2、Vue 3 和 Angular 应用托管，但 `@composeui/editor` 不依赖这些框架中的任何一个。

## 设计决策

采用 Dockview 的 JavaScript/TypeScript API 作为工作区布局内核。`@composeui/editor` 新增无框架入口 `mountEditorWorkspace(root, editor, options)`，调用方只需提供宿主 DOM、Core Editor 和当前 Page Record ID。

现有 `mountEditor` 继续作为独立的 2D 编辑视图入口。其 options 新增可选的 `session` 注入；未提供时维持当前行为并创建自己的 `EditorSession`。工作区始终注入自己创建的共享 Session。实现工作区时，将当前编辑视图中的组件树与画布职责拆成可分别挂载的面板，避免工作区 Scene 面板和 Canvas 面板重复渲染组件树。

React、Vue 2、Vue 3 和 Angular 的未来适配层仅负责组件生命周期：创建宿主 DOM、调用 `mountEditorWorkspace`，并在卸载时调用 `dispose()`。业务状态、Dockview 配置和面板实现不进入框架适配层。

## 第一阶段范围

第一阶段只实现 2D 工作区，因此不显示顶部模式栏。工作区仍保留模式注册机制；只有注册了两个或更多可用模式时才渲染模式栏。3D、Script、Game 和 Asset Store 不提供占位入口，也不属于本阶段交付范围。

2D 默认布局从左到右、从上到下为：

- 左上 Scene 面板：显示当前页面的节点树。
- 左下标签组：Resources 和 History。
- 中央 Canvas 面板：挂载现有 Page Board 和画布交互。
- Canvas 上方固定工具栏：选择、移动、缩放、吸附、锁定和视图控制等 2D 操作。
- 右侧标签组：Inspector 和 Signals，默认打开 Inspector。
- 底部标签组：Output、Debugger、Animation 和 Shader Editor。

底部工具面板在第一阶段提供可挂载、可停靠的面板外壳和明确空状态；尚无对应编辑器能力的面板不伪造业务功能。

## 工作区架构

### Workspace Shell

`EditorWorkspace` 负责创建 Dockview、注册面板、应用默认布局、恢复用户布局、协调模式与工具栏，并在销毁时释放全部资源。它不直接修改文档数据。

公开挂载结果至少包含：

- `session`：工作区内所有面板共享的 `EditorSession`。
- `api`：打开、聚焦、关闭和重置面板等工作区命令。
- `dispose()`：释放面板实例、事件订阅和 Dockview 实例。

### Panel Registry

每个面板由稳定的 descriptor 注册，descriptor 包含面板 ID、标题、图标、默认位置、可关闭策略及 `mount(container, context)` 生命周期。`mount` 返回 `dispose()`，Dockview 只管理容器与布局，不拥有面板业务状态。

第一阶段使用以下稳定面板 ID：

- `scene`
- `resources`
- `history`
- `canvas:<pageId>`
- `inspector`
- `signals`
- `output`
- `debugger`
- `animation`
- `shader-editor`

Canvas 是不可关闭的主面板。其他面板可以关闭，并可通过工作区菜单重新打开。面板标题使用简洁文本，命令按钮使用项目已有图标库或 Dockview 支持的图标元素，并提供 tooltip 与可访问名称。

### Mode Registry

`WorkspaceModeRegistry` 管理模式 ID、标题、工具栏和默认布局工厂。第一阶段只注册 `2d`。当可用模式数为 1 时不创建模式栏；达到 2 个时才显示真实的工作区切换控件。

模式注册机制不要求本阶段实现模式切换，也不为未来模式写入占位布局。

## 共享上下文与数据流

`EditorWorkspaceContext` 是所有面板共享的运行时上下文，包含 Core Editor、当前页面 ID、唯一的 `EditorSession`、工作区命令、资源服务接口和结构化事件入口。Workspace Shell 创建一次 Session 并注入所有面板；面板不得自行创建 Session。

Scene、Canvas 和 Inspector 读取同一个 `EditorSession.selection`：

1. 用户在 Scene 或 Canvas 中改变选择。
2. 发起方调用 `session.setSelection()`。
3. Scene、Canvas 和 Inspector 的订阅收到不可变状态快照。
4. 三个面板按同一选择状态更新，不维护镜像 selection。

Inspector 通过 Core Editor 命令修改属性，不直接修改 Record Store 或 DOM。每次有效修改进入现有 Transaction 与 History，因此 undo/redo 能恢复文档和 Inspector 显示。History 面板读取现有历史能力并调用统一的 undo/redo 入口。

Resources 通过注入的资源服务接口读取项目资源。缺少资源服务时显示空状态，不能让工作区挂载失败。Output、Debugger 等底部面板订阅结构化工作区事件，不通过全局变量或特定框架事件总线通信。

## 布局持久化

Dockview 布局是用户工作区偏好，不属于 ComposeUI canonical document，也不写入 `EditorSession` 的文档无关状态。

工作区通过可注入的 `WorkspaceLayoutStore` 保存和读取 Dockview JSON。Playground 首次接入使用带命名空间和布局版本的 `localStorage` 实现；宿主应用可以提供自己的同步或异步存储适配器。

持久化键至少区分工作区模式和布局版本，不按文档复制整份布局。页面相关 Canvas panel ID 在恢复时由当前 `pageId` 重新绑定，不能恢复旧文档的页面 ID。

以下情况回退到 Godot 风格默认布局：

- 没有已保存布局。
- 保存数据无法解析。
- 布局版本不兼容。
- Dockview 拒绝恢复布局。
- 恢复结果缺少不可关闭的 Canvas 主面板。

重置布局只清除工作区布局偏好并重新应用默认布局，不修改文档、selection、viewport 或历史记录。

## 错误与生命周期

单个辅助面板挂载失败时，在该面板容器内显示错误状态并记录结构化错误；Canvas 主面板挂载失败时，工作区保留外壳并显示阻断状态，不悄悄回退成空白画布。

布局恢复异常必须被捕获并回退默认布局。布局保存失败不影响当前编辑，但通过工作区事件报告。

`dispose()` 必须是幂等的，并按顺序停止布局保存、销毁所有面板实例、取消 Session/Core/资源订阅、销毁 Dockview，最后清空由工作区创建的 DOM。宿主框架重复卸载不能产生异常或遗留监听。

## 样式与交互

工作区采用紧凑、深色、工具型界面，参考 Godot 的信息密度，不复制 Godot 品牌元素。Dockview 主题变量由 `@composeui/editor` 的工作区样式统一设置，宿主应用可以通过公开 CSS custom properties 覆盖。

工作区占满宿主容器；Canvas 获得剩余空间并保持最小可用尺寸。Scene、Inspector 和底部面板有合理的最小宽高，拖动分隔线不能使标题、标签或命令按钮重叠。

画布工具栏属于 Canvas/2D 模式，不作为 Dockview 面板。它始终位于 Canvas 内容上方，使用图标按钮、tooltip、pressed 状态和可访问名称。单模式时工具栏上方不保留空的模式栏高度。

## 测试与验收

单元测试：

- Panel Registry 能注册稳定 ID、拒绝重复 ID，并正确调用 mount/dispose。
- 单模式不渲染模式栏；注册第二个模式后渲染模式栏。
- WorkspaceLayoutStore 能保存、恢复、版本失配回退和重置布局。
- 页面 Canvas ID 在恢复时绑定当前 `pageId`。
- `dispose()` 可重复调用且每个订阅和面板只释放一次。

Editor DOM 测试：

- 默认布局包含 Scene、Resources、History、Canvas、Inspector/Signals 和四个底部工具面板。
- Scene、Canvas 和 Inspector 共享选择状态，任一入口改变选择后其余面板同步。
- Inspector 修改通过 Core 命令进入历史，并可 undo/redo。
- 关闭辅助面板后可重新打开；Canvas 不可关闭。
- 辅助面板失败被隔离；Canvas 失败显示阻断状态。

Playground/E2E 验收：

- 首次打开呈现 Godot 风格默认布局，且没有顶部模式栏。
- 面板可以拖动、停靠、调整尺寸和切换标签。
- 刷新页面后恢复用户布局；损坏持久化数据时恢复默认布局。
- 重置布局不改变文档内容、selection 或历史。
- 桌面宽屏和最小支持视口下没有面板、标签、工具栏文本重叠。
- 工作区卸载后不再响应 Store 或 Session 更新。

## 非目标

- 不把编辑器重写为 React、Vue 或 Angular 组件树。
- 不在第一阶段实现 3D、Script、Game 或 Asset Store 模式。
- 不把 Dockview 布局写入 canonical JSON、Core Record Store 或 undo/redo 历史。
- 不在第一阶段实现完整资源管理器、调试器、动画编辑器或 Shader 编辑器业务。
- 不改变现有文档 schema。

## 依赖依据

Dockview 官方提供无框架 TypeScript/JavaScript 包，以及 React、Vue 和 Angular 包；同时提供布局序列化与恢复 API。本设计使用无框架包保持 `@composeui/editor` 的框架中立边界：

- <https://dockview.dev/>
- <https://dockview.dev/docs/overview/quickstart/?framework=javascript>
