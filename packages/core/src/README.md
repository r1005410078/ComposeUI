# `@composeui/core` 源码布局

本目录结构对应**文档权威内核**分层。对外只从根 `index.ts` 导出；内部模块按职责分目录。

```text
src/
├── index.ts                 # 公共出口
├── document/                # 可持久化文档模型
│   ├── schema.ts            # PageDocument / records
│   └── snapshot.ts          # canonicalizeDocument
├── store/                   # 归一化权威存储
│   ├── store.ts             # RecordStore
│   └── validation.ts        # 树策略 / deepEqual
├── kernel/                  # 写路径与编辑门面
│   ├── transaction.ts       # transact / applyPatch
│   ├── history.ts           # undo/redo/jump
│   ├── operations.ts        # EditorOperation 观察契约
│   └── commands/            # Command 插件子系统
│       ├── index.ts         # 子系统出口
│       ├── types.ts         # Editor / Command / Plugin 类型
│       ├── registry.ts      # CommandRegistry
│       ├── plugin.ts        # installCommandPlugins（构造期）
│       ├── editor.ts        # createEditor / dispatch
│       ├── errors.ts        # EditorInitializationError
│       └── builtin/         # 内置命令插件
│           ├── index.ts     # builtinCommandPlugin
│           ├── helpers.ts
│           ├── node-create.ts
│           ├── node-transform.ts
│           ├── node-tree.ts
│           └── page.ts
├── query/                   # 只读投影（不得依赖 commands）
│   ├── tree.ts              # getTreeItems / getChildren
│   └── types.ts             # LayoutProjection 类型占位（无默认实现）
└── shared/                  # 跨层小类型
    └── diagnostics.ts       # Diagnostic / Result
```

**写路径：** `commands`（registry → prepare → execute）→ `transaction` → `store`；`history` 只回放 patch。  
**Query：** 只读；`query/**` 禁止 import `kernel/commands`（见 `bun run boundaries`）。  
**插件：** 仅 `createEditor({ plugins })` 构造期安装；`dispatch` 按 `CommandId` 查 registry，无巨型 switch。  
**不放这里：** Session、DOM、Dockview、Yjs、业务组件框架。

**包边界：** editor / operation-log / apps 只能 `from "@composeui/core"`，禁止深路径。守卫脚本：`scripts/check-package-boundaries.mjs`（`bun run boundaries`）。

详见仓库根 [docs/current-architecture.md](../../../docs/current-architecture.md)。
