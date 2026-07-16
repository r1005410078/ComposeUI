# `@composeui/core` 源码布局

本目录结构对应**文档权威内核**分层。对外只从根 `index.ts` 导出；内部模块按职责分目录。

```text
src/
├── index.ts           # 公共出口
├── document/          # 可持久化文档模型
│   ├── schema.ts      # PageDocument / records
│   └── snapshot.ts    # canonicalizeDocument
├── store/             # 归一化权威存储
│   ├── store.ts       # RecordStore
│   └── validation.ts  # 树策略 / deepEqual
├── kernel/            # 写路径与编辑门面
│   ├── transaction.ts # transact / applyPatch
│   ├── history.ts     # undo/redo/jump
│   ├── commands.ts    # createEditor / dispatch（P1 将拆为 commands/ + plugin）
│   └── operations.ts  # EditorOperation 观察契约
├── query/             # 只读投影（不得依赖 commands）
│   └── projections.ts # 组件树等
└── shared/            # 跨层小类型
    └── diagnostics.ts # Diagnostic / Result
```

**写路径：** `commands` → `transaction` → `store`；`history` 只回放 patch。  
**Query：** 只读；`query/**` 禁止 import `kernel/commands`（见 `bun run boundaries`）。  
**不放这里：** Session、DOM、Dockview、Yjs、业务组件框架。

**包边界（P0）：** editor / operation-log / apps 只能 `from "@composeui/core"`，禁止深路径。守卫脚本：`scripts/check-package-boundaries.mjs`（`bun run boundaries`）。

**M1.5：** `kernel/commands/` 子目录与 Command 插件运行时是 **P1** 目标，当前仍为 `commands.ts` switch。见 [Foundation Upgrade](../../../docs/superpowers/specs/2026-07-16-foundation-architecture-upgrade-design.md) 与 [current-architecture §2.2](../../../docs/current-architecture.md#22-包依赖守卫p0-已落地)。

详见仓库根 [docs/current-architecture.md](../../../docs/current-architecture.md)。
