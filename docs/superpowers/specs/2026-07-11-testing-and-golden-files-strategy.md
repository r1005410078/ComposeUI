# ComposeUI 测试与黄金文件策略

## 目标

ComposeUI 的测试体系需要保护三个核心承诺：

1. 文档事务、布局和组件语义始终正确。
2. 相同输入经过迁移、导入和编译后产生稳定、可审查的输出。
3. 编辑器在真实浏览器中的拖拽、嵌入、渲染、协同和视觉表现可持续回归。

测试按照风险分层，不用大量脆弱 E2E 替代领域单元测试，也不把所有对象都做成无法理解的 Snapshot。

## 工具选择

| 层级 | 工具 | 用途 |
| --- | --- | --- |
| 单元与集成测试 | Vitest | Store、Transaction、Command、Policy、布局、Compiler、Adapter 契约 |
| 属性测试 | fast-check | 树结构、事务逆操作、布局和协同收敛不变量 |
| 黄金文件 | Vitest + 自定义 canonical serializer | Schema 迁移、Patch、RenderPlan、Figma 转换、布局输出 |
| 浏览器 E2E | Playwright Test | 用户流程、真实布局、Shadow DOM/Light DOM、框架 Adapter |
| 视觉回归 | Playwright `toHaveScreenshot` | 编辑器 UI、选框、布局、Figma 视觉结果 |
| 可访问性结构 | Playwright ARIA Snapshot + 显式断言 | 组件树、菜单、属性面板的语义结构 |
| 性能基准 | Playwright + Performance API + 自定义基准 | FPS、P95 帧耗时、长任务、DOM 和内存趋势 |

Vitest 与 Vite/TypeScript 工程集成紧密，并支持文件 Snapshot 和自定义序列化。[Vitest Guide](https://vitest.dev/guide/)、[Vitest Snapshot](https://vitest.dev/guide/snapshot.html)

Playwright 支持 Chromium、Firefox、WebKit 项目，以及页面和元素截图比较。[Playwright Projects](https://playwright.dev/docs/test-projects)、[Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots)

fast-check 生成大量输入并将失败缩减为最小反例，适合测试树、事务和布局不变量。[fast-check](https://fast-check.dev/docs/introduction/)

首版不同时维护 Vitest Browser Mode 和 Playwright 两套浏览器测试基础设施。纯逻辑使用 Vitest，必须依赖浏览器布局、Canvas、Shadow DOM 或 Pointer Event 的测试统一使用 Playwright。

所有浏览器示例、E2E、视觉和性能测试统一使用单一 Vite Playground，不引入 Storybook。完整方案见：[Vite Playground 示例与演示设计](./2026-07-11-vite-playground-demo-design.md)。

## 测试金字塔

```text
                 少量关键 E2E
              视觉与跨浏览器测试
           浏览器集成 / Adapter 契约
         黄金文件 / Compiler / Migration
      Command / Policy / Layout 单元测试
   Store / Transaction / Schema 不变量测试
```

越靠近内核，测试越快、越确定、数量越多。E2E 只覆盖跨模块关键旅程，不穷举所有属性组合。

## 单元测试

### Store 与 Transaction

必须覆盖：

- Record 创建、更新、删除和 Schema 校验。
- 事务原子性：任一 Policy 失败时无 Record 被提交。
- Forward Patch 和 Inverse Patch 对称。
- 执行事务、执行逆事务后恢复 canonical 等价状态。
- 批量修改只发布一个事务事件。
- Session Scope 不进入持久化 Snapshot。
- 索引增量更新和从 Snapshot 重建后结果一致。
- Origin、History 策略和 Diagnostic 正确传播。

### Command 与 Policy

每个 Command 至少包含：

- 成功路径。
- 前置条件拒绝。
- 边界输入。
- 原子撤销/重做。
- 结构化结果和 Diagnostic。

重点 Policy：

- 禁止循环父子关系。
- 单画板单框架。
- 容器与节点兼容性。
- 自定义组件定义循环引用。
- 实例公开属性和插槽边界。
- Grid 跨度、碰撞和锁定。
- 引用完整性和资源安全。

### 布局

- 自由布局的世界坐标与局部坐标转换。
- Auto Layout 的方向、间距、内边距、对齐、`fixed/hug/fill` 和绝对子项。
- Grid 的可配置列数、拖放、缩放、碰撞、嵌套和自动紧凑排列。
- 节点在 Free/Auto/Grid 之间移动时的布局数据转换。
- 浮点误差、零尺寸、负坐标、极端缩放和深层嵌套。

### Compiler 与 Runtime

- `PageDocument → RenderPlan` 每个 Compiler Pass。
- 只因相关 Record Patch 失效对应 DOM Island 或 GPU Layer。
- 自定义组件实例解析、公开属性优先级和插槽挂载。
- Binding 依赖表、Action 编译和错误诊断。
- 编辑器字段不进入发布 RenderPlan。

### 测试风格

- 一个测试只验证一个可说明的行为或不变量。
- 关键规则使用显式断言，不用 Snapshot 隐藏意图。
- 时间、随机 id、平台路径和 locale 通过依赖注入控制。
- 不 Mock 被测领域的核心协作者；只 Mock 网络、时钟、资源和外部框架边界。

## 属性测试

以下不变量使用 fast-check：

### 树结构

- 任意合法移动后每个节点最多有一个父节点。
- 不存在节点到自身的祖先路径。
- 删除父节点后不存在悬空子节点或引用。
- 任意命令序列后根节点和画板约束仍成立。

### Transaction

- `apply(forward); apply(inverse)` 与初始 canonical 状态相等。
- 两个互不影响的事务交换顺序后结果等价。
- 失败事务不改变 Store revision 和 Snapshot。

### 布局

- Grid 子项始终处于有效列范围。
- 不允许重叠时，碰撞处理后不存在重叠。
- 自动紧凑后不存在可按规则继续上移的空洞。
- 坐标正向/反向转换在误差范围内可逆。

### 自定义组件

- 定义依赖图始终无环。
- 任意有效定义更新后，实例公开覆盖仍可定位。
- 解除实例关联前后的视觉和公开属性解析结果等价。

发现失败时记录 fast-check seed 和最小反例，并将有业务价值的反例固化为普通回归测试。

## 黄金文件

黄金文件是 ComposeUI 最重要的兼容性测试之一。它用于保护稳定输入到稳定输出的公共契约，不等同于随意生成的对象快照。

### 必须使用黄金文件的场景

- 历史 `PageDocument` Schema 迁移结果。
- Command 事务的 Forward/Inverse Patch。
- Free/Auto/Grid 复杂布局计算结果。
- 自定义组件定义和实例解析结果。
- `PageDocument → RenderPlan` 编译输出。
- Figma 结构化载荷转换结果。
- SVG 清理和降级结果。
- 文档导入/导出和跨文档复制结果。
- Yjs 双客户端收敛后的 canonical PageDocument。
- 结构化 Diagnostic 输出。

### 不适合使用黄金文件的场景

- 单个布尔判断或简单数值计算。
- 随机 id、时间、内存地址或平台路径未规范化的输出。
- 实时业务数据和动画帧。
- 原始 Yjs 二进制 Update。Yjs 版本可能改变编码实现，应比较最终 canonical 文档和语义事件。
- 整个编辑器 DOM HTML。DOM 结构变化过于频繁，应改用行为断言、ARIA Snapshot 或局部截图。

### 目录结构

```text
packages/testing/
├─ fixtures/
│  ├─ documents/
│  ├─ layouts/
│  ├─ components/
│  ├─ figma/
│  ├─ yjs/
│  └─ assets/
├─ goldens/
│  ├─ migrations/
│  ├─ commands/
│  ├─ layouts/
│  ├─ render-plans/
│  ├─ figma-import/
│  ├─ yjs-convergence/
│  └─ diagnostics/
└─ canonicalizers/
```

每个黄金场景包含输入、期望输出和场景说明：

```text
figma-import/auto-layout-card/
├─ README.md
├─ input.figma.json
├─ expected.document.json
├─ expected.diagnostics.json
└─ expected.preview.svg
```

### Canonical Serializer

黄金文件写入前必须 canonicalize：

- 对稳定 Map key 排序。
- 保留具有业务意义的数组顺序。
- 将随机 id 映射为确定性测试 id。
- 移除创建时间、事务 id、客户端 id 和平台路径。
- 浮点数按约定精度规范化，但不能掩盖真实布局误差。
- 资源 URL 转换为固定测试 URI。
- Diagnostic 按 severity、code 和 record id 稳定排序。
- JSON 使用固定缩进、换行和 UTF-8。

Canonicalizer 需要版本号。修改 canonical 规则时，必须说明原因并审查所有黄金差异。

### 更新规则

- CI 永远不能自动更新黄金文件。
- 更新必须通过显式命令，例如 `npm run test:golden:update`。
- 黄金文件与代码修改在同一个 PR 中提交。
- Reviewer 必须审查语义差异，不能只确认测试变绿。
- 大面积变化需要附迁移说明或 RenderPlan 契约变化说明。
- 修复 Bug 时先添加会失败的 Fixture/Golden，再修改实现。
- 不允许用提高容差或删除 Golden 的方式隐藏未知回归。

Vitest 支持独立 File Snapshot，可以保留 JSON、HTML、SVG 等原始扩展名并进行文件比较。[Vitest File Snapshots](https://vitest.dev/guide/snapshot.html#file-snapshots)

## 浏览器集成测试

以下行为必须在真实浏览器中测试，不能依赖 jsdom：

- Shadow DOM 编辑器 UI 与 Light DOM 业务组件样式边界。
- Vue/React Adapter 挂载、更新、Portal/Teleport 和卸载。
- 页面级 Context、Router、Store、i18n 和主题继承。
- Pointer Event、拖拽、框选、缩放、滚动和键盘焦点。
- `getBoundingClientRect`、ResizeObserver、SVG 覆盖层坐标。
- Grid 和 Auto Layout 的真实 CSS 布局。
- 多编辑器实例的事件、快捷键和 Portal 隔离。
- iframe 预览 Adapter。

浏览器集成测试使用专用 Harness 页面，注册确定性测试组件、字体、主题和数据源，不依赖实际业务项目。

## E2E 测试

### 核心用户旅程

1. 创建画板，选择 Vue 或 React Adapter，拖入业务组件并保存。
2. 在 Free/Auto/Grid 容器间移动节点，撤销并重做。
3. 创建自定义组件，添加实例覆盖和插槽，修改定义后验证全部实例更新。
4. 绑定页面变量和宿主数据，触发 Action 并预览运行结果。
5. 从 Figma 粘贴 SVG 和结构化节点，检查导入摘要和降级诊断。
6. 关闭并重新加载页面，文档和 RenderPlan 保持一致。
7. 两个浏览器上下文通过 Yjs 同步，断网修改后重连并收敛。
8. 多编辑器实例同时存在时，选区、快捷键、历史和上下文互不影响。
9. 缺失组件、无效绑定和资源失败时显示可定位错误占位。

### 浏览器矩阵

- PR 必跑：Chromium，覆盖全部 E2E。
- 主分支或夜间：Chromium、Firefox、WebKit 核心旅程。
- 视觉黄金：固定 Chromium、固定操作系统、固定浏览器版本。
- 框架矩阵：Vue 和 React 官方 Adapter；Angular Adapter 发布后加入核心契约测试。

Playwright Project 用于浏览器、框架 Adapter、协同模式和只读模式的测试矩阵，避免复制测试文件。

### 定位策略

- 优先使用 Role、Label、可见名称和稳定测试语义。
- 画布节点使用稳定 `data-node-id`，但测试不能依赖随机生产 id。
- 不使用脆弱的深层 CSS Selector、DOM 顺序或像素坐标代替语义断言。
- 拖拽测试通过应用级测试 API 创建确定性初始状态，再执行真实 Pointer 操作。

### 失败产物

CI 失败时保留：

- Playwright Trace。
- 失败截图和视觉 Diff。
- Console、Page Error 和请求错误。
- 当前 canonical PageDocument。
- 最近事务和 Command 日志。
- Yjs 协同测试的客户端状态向量与最终 canonical 文档。

## 视觉黄金文件

视觉黄金只保护用户可见且难以用结构断言表达的结果：

- 编辑器整体布局。
- 组件树层级、选中、锁定、错误和实例覆盖状态。
- 画布选框、控制柄、吸附线和容器落点。
- Free/Auto/Grid 关键布局。
- Figma 导入前后的视觉结果。
- Shadow DOM 编辑器与宿主主题同时存在的样式边界。
- 4K 大屏典型页面。

### 确定性要求

- CI 使用固定 Docker/操作系统镜像和固定浏览器版本。
- 测试字体随测试工程提供，等待 `document.fonts.ready`。
- 禁用动画、光标闪烁、随机数据和动态时间。
- 固定 viewport、device scale factor、locale、timezone 和颜色模式。
- 等待图片、Canvas、GPU Layer 和布局稳定信号，不使用固定 sleep。
- 动态业务组件使用专用测试 Fixture 或遮罩，仅在动态内容不属于测试目标时隐藏。

视觉容差按场景设置。布局、选框和像素边界使用严格阈值；抗锯齿明显的图表允许小比例差异，但必须限制差异区域。Playwright 提醒截图结果会受操作系统、硬件和浏览器设置影响，因此 Baseline 必须在统一环境生成。[Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots)

## ARIA 与可访问性测试

组件树、工具栏、菜单、对话框和属性面板使用：

- 显式 Role/Name/State 断言。
- 键盘导航 E2E。
- 焦点进入、恢复和陷阱测试。
- 局部 ARIA Snapshot 保护复杂语义树。

ARIA Snapshot 只用于稳定语义区域，不对整个应用生成巨大快照。关键交互仍使用显式断言。

## Yjs 协同测试

协同测试使用两个或更多独立 Y.Doc/浏览器上下文和可控测试 Provider：

- 并发修改不同节点后收敛。
- 并发移动同一节点后收敛且结构合法。
- 当前用户撤销不回滚远程修改。
- Awareness 上线、更新和离线清理。
- 断网期间积累 Update，重连后自动合并。
- Schema 不兼容客户端拒绝写入。
- 组件定义、实例覆盖和 Grid 冲突的确定性修复。

Golden 比较最终 canonical 文档，不固定原始 Yjs Update 字节。

## 性能测试

性能测试不是普通单元测试的覆盖率组成部分，也不使用宽松截图代替指标。

固定场景：

- 20,000 文档节点加载和小 Patch。
- 50,000 组件树节点虚拟滚动和搜索。
- 500–1,000 可见 ComposeUI 节点平移、缩放和框选。
- 50–200 中等复杂业务组件。
- 10,000–30,000 页面总 DOM。
- 50,000 GPU 图元更新和拾取。
- 双客户端 Yjs 小型远程 Patch。
- 4K viewport 的典型大屏页面。

记录首次加载、交互准备时间、平均 FPS、P95/P99 帧耗时、长任务、主线程时间、内存趋势、DOM 数量和增量更新触达节点数。

性能 CI 分两层：

- PR 烟雾门禁：检测数量级退化和明显长任务。
- 固定硬件夜间基准：保存趋势并按稳定阈值告警。

共享 CI 的绝对毫秒波动较大，PR 门禁优先比较基线比例；固定硬件才执行严格预算。

## 覆盖率策略

不追求全仓统一 100%。建议：

- `schema/store/core/layout/compiler`：行和分支覆盖率目标不低于 90%。
- Adapter、Importer、Collaboration：不低于 80%，并有完整契约和黄金测试。
- 编辑器 UI：不以覆盖率为唯一指标，必须覆盖关键旅程、可访问性和视觉状态。
- 安全校验、迁移和事务回滚路径必须显式测试，不允许用覆盖率豁免隐藏。

覆盖率下降只是信号；关键不变量缺失测试时，即使数字达标也不能合并。

## 测试目录建议

```text
packages/
├─ core/
│  ├─ src/
│  └─ test/
│     ├─ unit/
│     └─ properties/
├─ compiler/
│  └─ test/golden/
├─ layout-grid/
│  └─ test/
├─ collaboration-yjs/
│  └─ test/
└─ testing/
   ├─ fixtures/
   ├─ goldens/
   ├─ canonicalizers/
   ├─ harness/
   └─ matchers/

apps/test-host/
├─ react/
├─ vue/
└─ vanilla/

e2e/
├─ editor/
├─ adapters/
├─ collaboration/
├─ visual/
└─ performance/
```

## CI 分层

### PR 必跑

1. 类型检查、lint 和依赖边界检查。
2. Vitest 单元、属性和黄金文件测试。
3. Chromium 核心 E2E。
4. 关键视觉黄金。
5. 性能烟雾测试。

### 主分支/夜间

1. Firefox、WebKit E2E。
2. 全视觉矩阵。
3. Yjs 断网、重连和并发压力测试。
4. 20,000/50,000 节点大文档测试。
5. 4K 大屏和 GPU Layer 固定硬件基准。
6. 长时间内存、监听器、Worker 和纹理泄漏测试。

## 落地顺序

1. 建立 Vitest、canonical serializer、Fixture 和 Golden 更新命令。
2. 为 Schema、Store、Transaction、Patch 和 Command 建立单元/属性测试。
3. 为布局、组件定义和 Compiler 建立黄金文件。
4. 建立 React/Vue/Vanilla 测试宿主和 Playwright Chromium E2E。
5. 加入视觉黄金、统一字体和截图环境。
6. 加入 Yjs 多客户端 Harness 和协同黄金。
7. 加入 Firefox/WebKit 夜间矩阵。
8. 加入大文档、4K 和 GPU 性能基准。
