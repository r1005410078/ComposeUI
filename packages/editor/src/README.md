# `@composeui/editor` 源码布局

本目录结构对应 **Session / Canvas / Tree / Workspace / Operation-log UI** 分层。  
持久文档变更必须调用 `@composeui/core` 的 `Editor.dispatch`，不得在本包内改写 RecordStore。

```text
src/
├── index.ts                 # 公共出口 + 样式入口
├── session/                 # Session Scope（不进 PageDocument）
│   ├── session.ts           # viewport / selection / gridSize / snapEnabled / …
│   ├── coordinates.ts       # screen ↔ world ↔ parent-local
│   └── snap.ts              # 网格吸附纯函数（snapScalar/Point/Rect）
├── canvas/                  # 画布 DOM + 指针交互（按职责拆分）
│   ├── mount.ts             # mountEditor 装配与订阅
│   ├── board-render.ts      # page board / 节点 DOM
│   ├── workspace-canvas.ts  # Canvas2D 无限网格 + 标尺/游标
│   ├── overlay.ts           # SVG 选框与手柄
│   ├── pointer.ts           # move/resize/group-resize 状态机（可选 snap）
│   ├── pointer-pan.ts       # 平移手势
│   ├── pointer-marquee.ts   # 框选
│   ├── pointer-helpers.ts   # 坐标 / 修饰键
│   ├── preview.ts           # 预览帧 / 回放 banner
│   ├── interactions.ts      # 拖拽草稿
│   ├── group-resize.ts      # 多选缩放几何
│   └── colors.ts            # 安全色
├── tree/                    # 组件树面板
│   └── component-tree.ts
├── operation-log/           # 日志控制器与 Session 桥接（UI 侧）
│   ├── adapter.ts
│   ├── controller.ts
│   └── controller-port.ts
├── workspace/               # Dockview 壳与默认面板
│   ├── editor-workspace.ts
│   ├── panels.ts / toolbar.ts / types.ts / …
│   ├── replay-*.ts
│   └── output/              # Output 面板子树
│       ├── panel.ts
│       ├── toolbar.ts
│       ├── replay-bar.ts
│       └── value-format.ts
└── styles/                  # 主题与结构样式
    ├── theme.css
    ├── editor.css
    └── workspace.css
```

**三态：** Document（core）· Session（本包 session/）· Workspace chrome（workspace/ + localStorage）。  
**引擎侧日志：** `@composeui/operation-log`；本包只做观察适配与 Output UI。

**包边界：** 本包只能 `from "@composeui/core"`，禁止 `@composeui/core/...` 或 `packages/core/src` 深路径。守卫：`bun run boundaries`（`scripts/check-package-boundaries.mjs`）。

详见 [docs/current-architecture.md](../../../docs/current-architecture.md)。
