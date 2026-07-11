# ComposeUI TypeScript、Bun 与 Oxc 脚手架设计

## 1. 目标

本设计定义 ComposeUI 开始实现时的最小工程脚手架。目标是提供快速、严格且容易嵌入现有 Web 项目的开发环境，同时避免在项目早期引入重复的任务编排器、代码检查器和构建器。

脚手架必须满足：

- 所有生产代码使用 TypeScript，并开启严格类型检查。
- 使用 Bun 安装依赖、管理 workspace 和执行仓库脚本。
- 使用 Oxlint 检查 JavaScript、TypeScript、TSX 和框架脚本。
- 使用 Oxfmt 统一代码与配置文件格式。
- 使用 Vite 构建 Playground 和浏览器库产物。
- 使用 Vitest 与 Playwright 承载既定测试策略。
- 发布的 ComposeUI 包不得要求宿主项目使用 Bun。

## 2. 明确不做什么

首版不引入：

- Turborepo 或 Nx。
- ESLint 与 Prettier。
- Storybook 或 Ladle。
- tsup、unbuild 或另一套库构建器。
- Bun 专属的生产运行时 API。
- 为尚未交付的能力预建空 workspace 包。

只有在真实仓库规模、CI 时间或 Oxc 规则缺口形成可测量问题后，才重新评估这些工具。

## 3. 工具职责

| 工具 | 唯一职责 |
| --- | --- |
| Bun | 依赖安装、`bun.lock`、workspace 管理和脚本执行 |
| TypeScript | 静态类型检查、项目引用和声明文件生成 |
| Oxlint | 代码质量、错误模式、导入关系和适用的类型感知检查 |
| Oxfmt | 源代码与受支持配置文件的确定性格式化 |
| Vite | Playground 开发服务器、浏览器应用构建和库模式构建 |
| Vitest | 单元、集成、属性及黄金文件测试 |
| Playwright | E2E、浏览器集成、视觉回归和性能冒烟测试 |

工具不得越权形成第二套同类流程。例如，不使用 Bun Test 替代 Vitest，也不同时运行 Prettier 和 Oxfmt。

## 4. Bun 的使用边界

Bun 是仓库开发工具，不是 ComposeUI 的运行时依赖：

- 根目录通过 `package.json#workspaces` 管理 `apps/*` 与 `packages/*`。
- workspace 内部依赖使用 `workspace:*`。
- 提交文本格式的 `bun.lock`，CI 使用冻结锁文件安装。
- 所有公共脚本通过 `bun run <script>` 暴露。
- 生产包不得导入 `bun:*`，不得依赖 `Bun` 全局对象。
- 发布产物必须能被 npm、pnpm、Yarn 和 Node 驱动的 Vite 宿主消费。
- `engines` 可以声明开发所需 Bun 版本，但不能把 Bun 声明为库消费者的 peer dependency。

## 5. TypeScript 策略

根 `tsconfig.base.json` 保存共享编译约束，至少启用：

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `useUnknownInCatchVariables`
- `verbatimModuleSyntax`
- `isolatedModules`

根 `tsconfig.json` 是 solution 配置，使用 `files: []` 和 `references` 指向实际存在的应用与包。每个可发布包使用 `composite`、`declaration` 和 `declarationMap`。

`tsc -b` 负责类型检查、项目依赖顺序和声明文件，不承担浏览器代码打包。Vite 负责 JavaScript、CSS 与资源产物。

公共包必须：

- 显式维护 `package.json#exports`。
- 区分运行时导出与 `type` 导出。
- 不通过根路径暴露内部模块。
- 不使用只在仓库路径别名下成立、发布后无法解析的导入。

## 6. Oxc 策略

使用根目录 `.oxlintrc.json` 与 `.oxfmtrc.json` 作为唯一检查和格式配置：

- `bun run lint` 执行 Oxlint，并把警告作为 CI 失败处理。
- `bun run lint:fix` 只应用 Oxlint 标记为安全的自动修复。
- `bun run format` 写入 Oxfmt 结果。
- `bun run format:check` 只检查，不修改文件。
- 编辑器保存格式化必须调用仓库固定版本的 Oxfmt。

若 Oxlint 暂时不能表达某条关键架构规则，优先使用以下方式补足：

1. TypeScript 项目引用与 `exports` 约束依赖方向。
2. Vitest 编写依赖边界或架构测试。
3. 使用小型、确定性的仓库脚本检查。

只有出现不可替代、持续存在的框架规则需求时，才评估受限范围的 ESLint；不得因为习惯默认引入完整 ESLint/Prettier 工具链。

## 7. 初始目录

脚手架第一阶段只创建能形成可运行纵向路径的内容：

```text
ComposeUI/
├── apps/
│   └── playground/
├── packages/
│   └── core/
├── tests/
│   └── e2e/
├── package.json
├── bun.lock
├── tsconfig.json
├── tsconfig.base.json
├── .oxlintrc.json
├── .oxfmtrc.json
└── playwright.config.ts
```

`editor`、`runtime`、`adapter-react`、`adapter-vue` 和协作适配器仅在对应纵向功能开始实现时创建。一个目录只有在拥有明确公共边界、独立依赖或独立发布需求时才升级为 workspace 包。

## 8. 标准脚本

根 `package.json` 对外提供稳定命令：

```text
bun run dev
bun run build
bun run typecheck
bun run lint
bun run lint:fix
bun run format
bun run format:check
bun run test
bun run test:golden
bun run test:e2e
bun run check
```

`check` 的固定顺序为：

1. `format:check`
2. `lint`
3. `typecheck`
4. `test`
5. `build`

Playwright 浏览器安装与 E2E 可作为独立 CI job，避免每次本地逻辑检查都启动浏览器。

## 9. 构建与发布约束

- Playground 使用 Vite 应用模式，且仍是唯一示例和浏览器测试宿主。
- 可发布浏览器包使用 Vite Library Mode；TypeScript 单独生成类型声明。
- Vue、React 等宿主框架声明为适配器包的 peer dependency，不打入核心产物。
- `@composeui/core` 不依赖 DOM 框架、Yjs、Figma SDK 或 GPU 实现。
- 构建结果必须验证 ESM 导出、类型声明、CSS/资源路径和 `sideEffects` 配置。
- 首版优先发布 ESM；只有确认目标宿主需要时才增加 CJS，不默认维护双格式。

## 10. CI 与可复现性

CI 必须：

- 固定 Bun 主次版本，并使用 `bun install --frozen-lockfile`。
- 运行根 `check` 命令。
- 对 E2E 使用固定 Playwright 浏览器、字体、DPR、语言和时区。
- 禁止自动更新黄金文件和视觉基线。
- 缓存 Bun 下载与 Playwright 浏览器，但不得缓存并复用来源不明的构建产物。

本地和 CI 必须调用相同的 `package.json` 脚本，不在 CI YAML 中复制另一套构建逻辑。

## 11. 引入更重工具的触发条件

仅在满足下列任一条件并有数据支撑时评估 Turborepo、Nx 或其他任务系统：

- workspace 数量和任务图使完整 CI 时间不可接受。
- 远程缓存能够显著降低稳定的重复构建成本。
- Bun workspace 过滤与 TypeScript 增量构建不能表达需要的任务依赖。

仅在 Vite Library Mode 无法可靠生成所需多入口、Worker、CSS 或发布格式时评估新的库构建器。

## 12. 验收标准

首个脚手架纵向切片完成时必须证明：

- 全新检出后，一条安装命令可以恢复依赖。
- `bun run check` 在本地和 CI 得到相同结果。
- Playground 可以引用 workspace 中的 `@composeui/core` 并运行。
- 类型错误、lint 错误和格式偏差都会让 CI 失败。
- 核心包构建后可以被一个不使用 Bun API 的普通 Vite 应用消费。
- 仓库中不存在重复的 lint、format、单元测试或示例运行器。

## 13. 官方依据

- [Bun Workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun Install](https://bun.sh/docs/pm/cli/install)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references)
- [Oxlint](https://oxc.rs/docs/guide/usage/linter)
- [Oxfmt language support](https://oxc.rs/docs/guide/usage/formatter/language-support)
- [Vite Library Mode](https://vite.dev/guide/build.html#library-mode)

