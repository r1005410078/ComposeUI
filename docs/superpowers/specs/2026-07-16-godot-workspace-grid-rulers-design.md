# ComposeUI Godot 式工作区网格与标尺设计

| 项 | 值 |
| --- | --- |
| 状态 | **正式定稿**（brainstorm 确认） |
| 日期 | 2026-07-16 |
| 类型 | 编辑器 Session / 画布 chrome 能力（非 M2 布局引擎） |
| 前置 | M1 视口/网格开关；M1.5 目录与 canvas 拆分 |
| 相关 | [当前实现架构](../../current-architecture.md)、[Foundation Upgrade](./2026-07-16-foundation-architecture-upgrade-design.md) |

---

## 1. 背景

当前 ComposeUI 编辑器具备无限 workspace 的 pan/zoom 与可开关的辅助网格样式，但：

- 网格主要是视觉辅助，**没有按步长的真实吸附**；
- **没有标尺与游标读数**；
- 节点为 Light DOM，选区为 SVG——符合可嵌入与未来业务组件方向。

产品希望参考 **Godot 2D 编辑器**：无限画布观感、可调网格、真实吸附、标尺游标；并明确 **底景用 HTML Canvas 绘制**，节点仍 DOM。

本能力属于 **编辑器 chrome / Session**，不是产品路线图中的 **M2 Auto Layout / Grid 布局引擎**。

---

## 2. 决策记录（brainstorm）

| 决策点 | 选择 |
| --- | --- |
| Canvas 绘制范围 | **仅编辑器底景**（网格 + 标尺/游标）；节点仍 DOM |
| 标尺深度 | **标尺 + 鼠标游标读数**；无永久 guides；无完整测量工具 |
| 吸附范围 | Free Layout **move + resize**（含多选）；可吸附创建落点 |
| 无限画布与 Board | **Godot 式**：网格铺满无限 world；page board 为文档边界参考框 |
| 实现路径 | **Canvas2D 底景 + 纯函数吸附**（非 WebGL；非仅 CSS） |

---

## 3. 目标与非目标

### 3.1 目标

1. 使用 **HTML Canvas** 在无限 workspace 上绘制世界网格（主/次线）与 **顶/左标尺 + 指针游标读数**。
2. 提供 **真实网格吸附**：在吸附开启时，Free Layout 的 **move / resize**（含多选）按可配置步长对齐 parent-local 坐标与尺寸。
3. **网格显示**（`gridVisible`）与 **吸附**（`snapEnabled`）独立开关；**步长**（`gridSize`）可调。
4. Page board 继续表示 `PageDocument` 中的页面宽高/背景；网格不裁剪在 board 内。
5. 节点渲染保持 Light DOM；选区可继续使用 SVG overlay。
6. 网格/吸附相关状态为 **Session Scope**（可进 operation-log），**不进入** canonical `PageDocument`。
7. 与现有写路径兼容：最终几何仍经 `Editor.dispatch` → transaction → history。

### 3.2 非目标

- 将矩形/业务节点整场景改到 Canvas 或 WebGL 渲染。
- 从标尺拖出永久参考线（guides）、完整点对点测量/卡尺工具。
- 节点边缘互吸、相对间距智能吸附等 Godot 全套对齐。
- Auto Layout / 产品 **Grid 布局引擎**（M2）。
- 去掉 page 尺寸的 schema 变更；不把 workspace 视口写入文档。

---

## 4. 架构

### 4.1 模块

```text
packages/editor/src/
  session/
    session.ts           # gridVisible（已有）+ gridSize + snapEnabled
    coordinates.ts       # screen ↔ world（已有）
    snap.ts              # 纯函数吸附（新）
  canvas/
    workspace-canvas.ts  # Canvas：世界网格 + 标尺刻度/游标（新）
    mount.ts             # 挂接 canvas 层、DPR/resize、订阅 session 重绘
    pointer.ts           # preview/commit 可选 snap（改）
    board-render.ts      # page board + 节点 DOM（职责不变）
    overlay.ts           # 选区 SVG（职责不变）
  workspace/toolbar.ts   # 网格/吸附/步长控件（改）
```

### 4.2 绘制栈（自下而上）

1. **Workspace Canvas**：无限 world 网格（视口裁剪绘制）。
2. **DOM**：page board + 节点。
3. **SVG overlay**：选区、手柄、框选。
4. **标尺层**：固定在 workspace 视口边缘的顶/左标尺（刻度与游标用 Canvas 或同层 canvas 区域绘制）；不随节点 DOM 滚动错位——与 viewport 数学一致。

### 4.3 坐标约定

| 空间 | 用途 |
| --- | --- |
| **Screen / workspace 像素** | 指针事件、Canvas CSS 尺寸 |
| **World** | 无限工作区；网格线与标尺刻度；viewport 变换（已有 `screenToWorld` / `worldToScreen` / `zoomAt`） |
| **Parent-local** | `NodeRecord.layout` 的 x/y/width/height；**吸附在此空间量化**后写入 |

Page board 在 world 中的位置与现 M1 实现保持一致（不在本设计中重定义 board 原点，除非实现发现文档与代码不一致时以代码为准并记入实施计划）。

### 4.4 数据流

```text
session.viewport | gridSize | snapEnabled | gridVisible | pointer position
        │
        ▼
workspace-canvas.redraw(...)

pointer move/resize preview
        │
        ├─ snapEnabled && !tempDisableSnap  → snap local geometry → DOM preview
        └─ else → unsnapped preview

pointer up / commit
        │
        ▼
snap（若启用）→ Editor.dispatch(node.move | node.resize | node.resizeMany)

toolbar setGridSize / setSnapEnabled / setGridVisible
        │
        ▼
EditorSession → listeners → canvas redraw + subsequent gestures
```

---

## 5. Session 状态

在 `EditorSessionState` 中：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `viewport` | 已有 | — | pan/zoom |
| `gridVisible` | 已有 `boolean` | `true` | 是否绘制网格 |
| `gridSize` | `number` | `8` | 次网格步长（world/local 同一数值语义下的步长单位） |
| `snapEnabled` | `boolean` | `true` | 是否启用吸附 |

**校验：**

- `gridSize` 必须有限且 `> 0`；建议实施时限制合理上下界（如 `1…1024`），非法 `setGridSize` 抛稳定错误码（如 `INVALID_GRID_SIZE`）。
- 主网格间距：`gridSize * majorEvery`，`majorEvery` 默认常量 `4`（本里程碑可不做成用户配置）。

**持久化：** 不进 `PageDocument`。可选：记入 session operation-log；是否写入 localStorage 与 workspace 布局一并保存 **本里程碑不强制**（若做，键与 schema 在实施计划中单独定义，默认不做）。

---

## 6. 吸附规则

### 6.1 纯函数

```ts
/** step 必须有限且 > 0 */
function snapScalar(value: number, step: number): number {
  return Math.round(value / step) * step
}

function snapPoint(p: { x: number; y: number }, step: number): { x: number; y: number }

/** 按改变的边量化矩形，保证 width/height ≥ 1 且有限 */
function snapRect(
  rect: { x: number; y: number; width: number; height: number },
  step: number,
  edges?: { left?: boolean; top?: boolean; right?: boolean; bottom?: boolean },
): typeof rect
```

### 6.2 与命令的衔接

| 操作 | 行为 |
| --- | --- |
| **Move** | 对每个被移动的 top-level 节点（与 core `node.move` 顶层规则一致）的 `layout.x/y` 吸附后再 dispatch delta 或等价最终坐标命令（保持现有 command 形状：`node.move` 用 delta 时，在 commit 时用吸附后的目标位置反算 delta） |
| **Resize** | 单节点 `node.resize` / 多选 `node.resizeMany`：对结果矩形做边相关吸附，再 dispatch |
| **Create**（若 UI 有落点创建） | 初始 x/y 吸附 |
| **snapEnabled === false** | 不吸附 |
| **临时关闭** | 按住 **Alt** 时本次手势不吸附（与 Godot 类编辑器常见习惯一致）；本里程碑 **默认实现** |

`gridVisible === false` **不**自动关闭吸附；两者独立。

### 6.3 预览与提交

- 预览阶段：DOM/叠层显示吸附后的几何，避免「松手跳动」。
- 提交：一次 `dispatch`，一个 undo 步（现有语义）。

---

## 7. Canvas 绘制规则

### 7.1 网格

- 在 **world** 空间按 `gridSize` 画次线，按 `gridSize * majorEvery` 画主线。
- 仅绘制 **当前 viewport 可见范围外扩一圈** 的线段，禁止对「无限」做无界循环。
- 当 zoom 导致次线过密时：可跳过次线只画主线，或提高次线透明度（实施时选一种并写单测/注释）；避免性能塌陷。
- **DPR**：backing store 像素 = CSS 尺寸 × `devicePixelRatio`；重绘时重置 transform。

### 7.2 标尺与游标

- 顶边：水平 world X 标尺；左边：垂直 world Y 标尺。
- 刻度与数字随 viewport 缩放/平移更新。
- 指针位于 workspace 内容区时：在两标尺上绘制游标线，并显示当前 **world** 坐标读数。
- 指针离开 workspace：隐藏游标与读数。

### 7.3 Page board

- Board 仍由 `board-render` 用文档中的 width/height/background 绘制。
- 网格 **穿过** board 内外连续绘制（Godot 世界网格），board 边框保持可辨识（现有 outline token）。

---

## 8. UI

工具栏（或等价入口）至少提供：

1. 切换 `gridVisible`
2. 切换 `snapEnabled`
3. 设置 `gridSize`（预设 8 / 16 / 32 + 合法自定义数字）

控件需稳定 `data-testid` 或 role，供 E2E 使用。

---

## 9. 测试策略

| 层 | 内容 |
| --- | --- |
| 单元 | `snap.ts`：整数/小数步长、非法 step、矩形吸附后 min size |
| Session | `setGridSize` / `setSnapEnabled` 校验与无变化短路 |
| 指针/集成 | snap on/off、Alt 临时关闭下 commit 几何（扩展现有 editor 测试） |
| Canvas | 纯逻辑：给定 viewport + gridSize 计算应画线索引范围；可选视觉烟雾 |
| E2E | 开关网格/吸附、改步长；拖拽后节点位置为步长倍数（在固定场景下） |
| 回归 | canonical 文档 golden **不**因仅开关网格/吸附而改变；移动吸附后文档坐标可预期变化 |

---

## 10. 验收出口

1. 无限 world 网格与标尺/游标在 pan/zoom 下与节点空间对齐。
2. `snapEnabled` 为 true 时 move/resize 落在 `gridSize` 网格上；为 false 时不强制对齐。
3. `gridSize` 可改且立即影响后续吸附与网格绘制。
4. `gridVisible` 仅影响绘制。
5. Session 字段不出现在 `canonicalizeDocument` 输出中。
6. 节点仍为 DOM 渲染；`bun run check` 通过。

---

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Canvas 与 DOM 视口不同步 | 统一使用 session.viewport；同一套 coordinates |
| 高 DPR / resize 糊或错位 | 集中 resize 处理；测试 devicePixelRatio |
| 吸附与 core min size 冲突 | snap 后 clamp width/height ≥ 1 |
| 与 M2 布局引擎混淆 | 命名与文档强调「workspace grid snap」≠ layout mode grid |
| 性能：全屏密网格 | 视口裁剪 + 过密省略次线 |

---

## 12. 实施顺序建议

1. `session/snap.ts` + 单测  
2. Session 字段与 toolbar  
3. `workspace-canvas` 网格绘制 + mount 挂接  
4. 标尺与游标  
5. pointer 接入 snap（preview + commit）  
6. E2E 烟雾  

---

## 13. 定稿说明

本文档经 brainstorm（Canvas 范围、标尺深度、吸附范围、world/board 关系、Canvas2D 路径）确认后 **正式定稿**，作为该能力的实施与验收依据。后续变更须修订本文并同步实施计划。
