# ComposeUI Yjs 实时协同设计

## 目标

ComposeUI 将基于 Yjs 支持同一页面文档的多人实时协同、离线编辑、自动合并、在线状态、远程选区和本地撤销/重做。

协同能力是明确产品目标，但不阻塞首版单人编辑器闭环。第一阶段的 Record Store、事务引擎、稳定 id、Patch 和命令系统必须保证未来可接入 CRDT；实际 Yjs 同步作为独立交付阶段实现。

## 边界

ComposeUI 负责：

- `PageDocument` 与 Yjs Shared Types 的映射。
- 本地命令事务和 Yjs 事务的桥接。
- 远程更新投影到本地 Record Store。
- 本地撤销/重做、在线成员、远程选区和冲突诊断。
- Schema 兼容、结构约束校验和异常数据修复。

宿主应用负责：

- 用户身份、文档访问权限和服务端鉴权。
- WebSocket、WebRTC 或自定义 Yjs Provider。
- Yjs Update 的服务端持久化、快照、备份和审计。
- 房间发现、断线重连策略和服务容量。
- 图片、字体等二进制资源存储。

Yjs Provider 通过端口注入，ComposeUI 不绑定特定协同服务端。

## 包结构

```text
@composeui/core
  ├─ Record Store
  ├─ Transaction Engine
  ├─ Command / Query
  └─ Schema / Migration

@composeui/collaboration
  ├─ CollaborationPort
  ├─ Presence Model
  └─ Collaboration Diagnostics

@composeui/collaboration-yjs
  ├─ Y.Doc Mapping
  ├─ Transaction Bridge
  ├─ Awareness Bridge
  ├─ Undo Bridge
  └─ Provider Adapter
```

`@composeui/core` 不依赖 Yjs；Yjs 只是 `CollaborationPort` 的官方实现。

## 权威状态

单人模式下，规范化 Record Store 是编辑会话的权威状态。

协同模式下，Y.Doc 是共享文档的权威状态，Record Store 是面向查询、索引和渲染的本地投影：

```text
Local Command
    │
    ▼
Transaction Bridge
    │
    ▼
Y.Doc Transaction ───── Provider ───── Remote Peers
    │
    ▼
Yjs Events
    │
    ▼
Record Store Patch
    │
    ├─ Component Tree
    ├─ Canvas / Selection
    └─ RenderPlan Incremental Compiler
```

禁止同时把 Y.Doc 和 Record Store 当成可独立写入的双重真值。协同模式中的本地修改必须先进入 Yjs 事务，再由同一事务事件生成 Record Store Patch；远程更新走相同投影路径。

## Y.Doc 数据映射

页面文档按规范化 Record 映射，不把完整深层 `PageDocument` 作为一个 JSON 值写入 Y.Map：

```text
Y.Doc
├─ meta: Y.Map
├─ nodes: Y.Map<NodeId, Y.Map>
├─ componentDefinitions: Y.Map<DefinitionId, Y.Map>
├─ assets: Y.Map<AssetId, Y.Map>
├─ bindings: Y.Map<BindingId, Y.Map>
└─ documentSettings: Y.Map
```

节点使用稳定 `nodeId`，并保存 `parentId` 和可并发排序的 `index`。不使用深层嵌套 Y.Array 表示整棵组件树，因为节点移动会涉及 Shared Type 迁移限制，也会放大父容器冲突和观察成本。

普通标量和小型结构化属性可以作为 JSON 值存储，但更新时必须整体替换，禁止直接修改从 Y.Map 取出的普通对象。需要字段级并发合并的属性使用嵌套 Y.Map。

富文本如进入产品范围，使用 Y.Text；普通短文本属性继续作为标量处理，避免无必要的 Shared Type 数量。

参考：[Yjs Shared Types](https://docs.yjs.dev/getting-started/working-with-shared-types)、[Y.Map](https://docs.yjs.dev/api/shared-types/y.map)。

## 排序与移动

同级顺序使用可比较的分数索引或等价稳定顺序键，不为每次插入移动整个数组。移动节点在一个 Yjs 事务中同时更新：

- `parentId`。
- `index`。
- 与布局容器相关的布局数据。

并发移动同一节点时，Yjs 最终收敛到一个字段结果。事务完成后运行结构校验器，处理以下异常：

- 父节点不存在。
- 节点成为自己的祖先。
- 父节点不接受子节点。
- 跨框架业务组件进入当前画板。
- Grid 位置冲突。

可确定修复的问题使用稳定规则自动修复；涉及业务语义时显示协同冲突诊断，不静默删除内容。

## 事务桥接

每个 ComposeUI 命令对应一个 Yjs 原子事务：

```ts
ydoc.transact(() => {
  applyCommandToYjs(command)
}, commandOrigin)
```

一个命令中的多节点移动、组件创建、粘贴和删除必须在同一事务中提交。Yjs 官方建议把相关修改合并到事务，以减少观察回调和同步 Update。[Y.Doc Transactions](https://docs.yjs.dev/api/y.doc)

事务 `origin` 至少区分：

- 当前编辑器实例的本地用户命令。
- 远程 Provider Update。
- Schema Migration。
- 自动修复和一致性维护。
- 导入、批处理和系统初始化。

`origin` 用于撤销范围、遥测、避免同步回环和诊断来源，不能依赖字符串碰撞，优先使用稳定对象或类型化标识。

## 撤销与重做

协同模式使用 Y.UndoManager，并通过 `trackedOrigins` 只跟踪当前用户在当前编辑器实例发起的可撤销命令。远程用户修改、Schema Migration 和自动修复默认不进入本地撤销栈。

拖拽连续帧可以合并为一个撤销步骤；结束拖拽、切换命令类型或显式提交后停止捕获。删除、粘贴、创建组件等结构操作保持原子撤销。

参考：[Y.UndoManager](https://docs.yjs.dev/api/undo-manager)。

## 在线状态与远程选区

用户在线状态通过 Yjs Awareness 传播，不写入 Y.Doc，也不进入持久化快照。Awareness 内容包括：

```ts
interface CollaborationPresence {
  user: {
    id: string
    name: string
    color: string
    avatarUrl?: string
  }
  activePageId?: string
  selectedNodeIds?: string[]
  cursor?: { x: number; y: number }
  viewport?: { x: number; y: number; zoom: number }
  editingDefinitionId?: string
}
```

远程光标、选区和视口状态必须降频发送，并限制选区数组和其他字段大小。远程用户离线后，其 Awareness 状态自动移除，不在文档中留下节点状态。

参考：[Yjs Awareness](https://docs.yjs.dev/getting-started/adding-awareness)。

## 锁定与并发编辑

默认采用乐观协同，不因为一个用户选中节点就阻止其他用户编辑。远程选区只作为提示。

以下操作可以使用软锁或短期租约：

- 编辑自定义组件定义结构。
- 执行大型 Figma 导入。
- Schema Migration。
- 批量资源替换。

软锁通过 Awareness 或宿主服务传播，不作为安全权限。锁过期或用户离线后必须自动释放。真正的写权限必须由服务端 Provider 和宿主鉴权控制。

## 自定义组件协同

组件定义和实例使用稳定 id，因此多人可以同时编辑不同定义或不同实例覆盖。

编辑定义时：

- 定义内部节点修改通过同一个 Y.Doc 同步。
- 实例投影根据定义变更增量失效。
- 删除公开属性、插槽或事件前检查当前实例引用。
- 并发修改组件契约产生不可自动兼容的结果时，显示契约冲突诊断。
- 循环定义检测在每次相关事务后执行，并使用确定性规则阻止或修复循环引用。

## Schema 与迁移

协同房间中的客户端必须满足宿主规定的 Schema 兼容范围。迁移由具备权限的一方执行，并使用专用 `migrationOrigin` 在单个事务或可恢复的分批事务中完成。

迁移期间其他客户端进入只读或等待状态，避免不同 Schema 客户端同时写入。客户端发现文档版本高于自身支持范围时必须拒绝编辑，不能尝试降级写入。

迁移完成后记录目标 Schema 版本和迁移标识；服务端应在迁移前保留快照。

## Provider、持久化与离线

ComposeUI 通过以下端口接入宿主 Provider：

```ts
interface CollaborationProvider {
  connect(doc: Y.Doc, awareness: Awareness): Promise<void>
  disconnect(): Promise<void>
  status(): "offline" | "connecting" | "connected" | "error"
  onStatusChange(listener: (status: string) => void): Disposable
  destroy(): void
}
```

Provider 可以基于 WebSocket、WebRTC 或宿主自定义协议。只要所有 Yjs Update 最终传播给参与者，文档会收敛；Update 可以作为 Uint8Array 增量存储和传输。[Yjs Document Updates](https://docs.yjs.dev/api/document-updates)

离线编辑期间，本地 Update 保存在宿主选择的持久化 Provider 中；恢复连接后自动同步。宿主负责限制离线缓存大小、清理过期文档和处理用户退出登录。

二进制图片和字体不写入 Y.Doc。Y.Doc 只同步稳定资源 id、元数据和状态，资源内容由 `AssetAdapter` 独立上传和下载。

## 权限与安全

- 客户端只读模式不能替代服务端权限校验。
- Provider 服务端必须验证用户是否可加入房间和提交 Update。
- 不可信协同文档仍需经过组件注册、绑定、SVG 和资源安全校验。
- Awareness 字段不得包含访问令牌、隐私数据或大体积业务内容。
- 宿主负责文档审计、成员管理、封禁、备份和恢复。

## 性能策略

- Yjs 事件转换为按 Record id 分组的最小 Patch，不对每次事务生成完整 `PageDocument`。
- Record Store、组件树、画布和 RenderPlan 编译器只订阅相关记录。
- 大型批处理使用单个事务或有明确检查点的分批事务。
- Awareness 光标和视口更新执行节流，丢弃过期中间状态。
- 服务端定期生成快照并压缩历史 Update，避免无限增长。
- 大文档按实际基准评估 Y.Doc 拆分或 Subdocument，但不在首版提前引入。
- 实时业务数据不进入 Yjs；Yjs 只同步页面配置和协同编辑状态。

## 测试与验收

自动化测试至少覆盖：

1. 两个客户端并发修改不同节点后文档一致。
2. 两个客户端并发移动同一节点后文档收敛且结构合法。
3. 多节点拖拽、粘贴和组件创建保持原子事务。
4. 当前用户撤销不回滚远程用户修改。
5. 断网编辑后重新连接能够合并并收敛。
6. Awareness 正确显示和清理远程光标、选区与在线成员。
7. 并发修改组件定义和实例覆盖后引用关系有效。
8. 非法父子关系、循环组件定义和 Grid 冲突得到确定性处理。
9. 不兼容 Schema 客户端进入只读或拒绝编辑。
10. Provider、观察器和 Awareness 在编辑器卸载后全部释放。
11. 20,000 节点文档的远程小型 Patch 不触发全量序列化或全树渲染。
12. 资源只同步 id 和元数据，不把二进制内容写入 Y.Doc。

## 交付顺序

1. 核心事务准备：稳定 Record id、规范化 Store、原子 Transaction、类型化 Origin、Patch 和确定性校验。
2. Yjs 映射原型：节点、组件定义、绑定和资源元数据映射到 Y.Doc，并完成双客户端收敛测试。
3. Provider 端口：接入宿主 WebSocket Provider、离线持久化和连接状态。
4. Awareness：在线成员、远程光标、选区和编辑上下文。
5. 本地撤销：Y.UndoManager、命令合并和 Origin 跟踪。
6. 冲突诊断：非法树结构、组件契约、Grid 和迁移协调。
7. 大文档基准、Update 压缩、服务端快照和长期稳定性测试。

