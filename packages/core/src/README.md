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
│   ├── commands.ts    # createEditor / dispatch
│   └── operations.ts  # EditorOperation 观察契约
├── query/             # 只读投影
│   └── projections.ts # 组件树等
└── shared/            # 跨层小类型
    └── diagnostics.ts # Diagnostic / Result
```

**写路径：** `commands` → `transaction` → `store`；`history` 只回放 patch。  
**不放这里：** Session、DOM、Dockview、Yjs、业务组件框架。

详见仓库根 [docs/current-architecture.md](../../../docs/current-architecture.md)。
