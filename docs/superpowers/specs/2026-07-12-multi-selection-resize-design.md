# 多选节点整体缩放设计

## 背景

M1 当前只支持单个 Free Layout 矩形通过右下角手柄缩放。用户框选多个节点后，期望通过一个整体选区框缩放所有节点，而不是只改变被点击节点的尺寸。

## 目标

1. 同一父节点下的多个已选矩形显示一个整体外包围框。
2. 外包围框提供上、下、左、右和四角共八个缩放手柄。
3. 拖动手柄时，节点的位置、尺寸和选区反馈在预览阶段同步更新。
4. 松手时通过一个可撤销事务提交所有节点的布局变化。
5. 取消、失焦或按 Escape 时不修改 `PageDocument`，并恢复初始视觉状态。

## 非目标

- 不支持跨父容器的整体缩放。
- 不支持 Auto Layout、Grid、业务组件或矢量节点的整体缩放。
- 不支持镜像翻转；拖过对边时保持最小整体尺寸，不交换锚点。
- 不改变单选节点现有的右下角缩放交互。

## 可用性条件

整体缩放仅在以下条件同时满足时提供：

- 选区包含至少两个可见的 `rectangle` 节点。
- 所有节点的 `parentId` 相同。
- 所有节点及其祖先均未锁定。

条件不满足时，仅显示现有的单节点选区和手柄；不静默排除选区中的节点。

## 交互与几何

定义选中节点在共同父坐标系中的外包围框为：

```text
left   = min(node.layout.x)
top    = min(node.layout.y)
right  = max(node.layout.x + node.layout.width)
bottom = max(node.layout.y + node.layout.height)
```

手柄调整相应边界，未被拖动的对边或对角固定为锚点。整体宽高始终不小于 `1`，因此不发生翻转。

对每个节点应用独立水平和垂直比例：

```text
scaleX = nextBounds.width / initialBounds.width
scaleY = nextBounds.height / initialBounds.height

nextX      = nextBounds.left + (node.x - initialBounds.left) * scaleX
nextY      = nextBounds.top + (node.y - initialBounds.top) * scaleY
nextWidth  = max(1, node.width * scaleX)
nextHeight = max(1, node.height * scaleY)
```

边手柄只改变一个比例；角手柄同时改变两个比例。缩放基于原始拖拽快照计算，不累积每次指针移动的浮点误差。

## 编辑器预览

选区 SVG 覆盖层新增整体框和八个屏幕空间手柄。手柄保持固定屏幕尺寸并接受指针事件；覆盖层其余区域继续不拦截画布操作。

拖拽期间：

- 每个受影响节点临时写入 `left`、`top`、`width`、`height` 样式。
- 各节点的选区轮廓、整体框和手柄按临时布局重绘。
- 不写入 Record Store、`PageDocument` 或历史记录。

结束、取消或异常清理时，移除临时样式并由当前持久化记录重绘选区。

## 命令与事务

新增 `node.resizeMany` 命令：

```ts
{
  id: "node.resizeMany",
  payload: {
    items: Array<{
      id: string
      x: number
      y: number
      width: number
      height: number
    }>
  }
}
```

命令在提交前验证：

- `items` 至少含两个不重复节点。
- 节点存在且为可变换的矩形节点。
- 节点具有相同 `parentId`。
- 节点及祖先未锁定。
- `x`、`y`、`width`、`height` 为有限数，且宽高至少为 `1`。

验证成功后，在一个 `local-command` 事务中更新所有布局记录，产生一组前向和反向 Patch，因此撤销、重做与协同适配器均将其视为单次编辑。任何验证失败都不提交部分变化。

## 测试

Vitest：

- `node.resizeMany` 的成功更新、单一历史步骤和撤销恢复。
- 重复节点、跨父节点、锁定节点和非法尺寸的诊断与原子失败。
- 八个手柄中代表性的右下、左上和单轴边缩放几何。
- 预览不改变持久化文档；取消后恢复节点和选区。

Playwright：

- 框选两个同级节点后显示八个整体手柄。
- 拖动右下、左上和右侧手柄时，两个节点同步改变位置/尺寸。
- 一次撤销恢复所有节点；不合格选区不显示整体手柄。

## 验收标准

- 用户可通过八个方向缩放同一父节点下的多选矩形。
- 各节点的位置、间距和尺寸按整体框的二维比例变化。
- 每次整体缩放只生成一个文档事务和一个撤销步骤。
- 预览、取消、缩放、撤销和重做均不留下临时 DOM 或选区状态。
