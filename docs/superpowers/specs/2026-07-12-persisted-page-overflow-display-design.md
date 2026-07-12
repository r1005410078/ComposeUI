# 页面画布越界显示持久化设计

## 目标

为 Page Board 增加可持久化的越界显示配置。用户可以决定超出白色画布边界的节点是否显示；编辑器、导出的 canonical JSON 和正式运行时使用同一配置。

默认行为是显示画布外内容，便于发现、选择并拖回越界节点。

## 设计决策

复用现有 PageRecord.overflow，不增加 showOutsidePage 等重复字段。

映射关系：

- visible：显示超出 Page Board 的节点。
- hidden：裁剪超出 Page Board 的节点。
- scroll：保留现有模型兼容性，但本次布尔切换控件不直接选择该值。

新建页面默认使用 overflow: "visible"。已有文档保持原值，不执行隐式迁移。

## Core 命令

新增 page.setOverflow 命令，payload 包含 Page Record ID 和 visible、hidden、scroll 三种 overflow 值。

行为约束：

- 目标必须是已存在的 Page Record。
- 非法记录 ID 或非法值返回结构化诊断。
- 修改通过 Command、Transaction 和 History 完成。
- 一次修改对应一个原子事务和一个撤销步骤。
- no-op 修改不创建历史记录。
- undo/redo 精确恢复先前的 overflow 值。

## 编辑器渲染

Page Board 直接使用持久化的 page.overflow 设置 CSS overflow。

- visible 时，节点 DOM 可以绘制到白色画布之外，并保持可选中、可框选和可拖动。
- hidden 时，超出白色画布的节点内容被裁剪。
- SVG 选区和临时交互反馈保持与节点可见区域一致。

该配置不是 Session Scope，不放入 EditorSession。

## Playground 控件

Playground 工具栏增加“显示画布外内容”切换按钮：

- aria-pressed="true" 对应 overflow: "visible"。
- 开启时执行 page.setOverflow 设置为 visible。
- 关闭时执行 page.setOverflow 设置为 hidden。
- 按钮状态从当前 Page Record 派生，不维护第二份状态。
- 外部命令、undo 或 redo 修改 overflow 后，按钮状态同步更新。

如果载入页面的值为 scroll，按钮显示为未开启；用户下一次切换时进入 visible。

## 持久化与兼容性

- canonical JSON 继续序列化 PageRecord.overflow。
- 不改变 schema 版本，也不增加迁移。
- 旧文档中的 hidden 或 scroll 保持不变。
- createEmptyDocument 创建的新页面从 hidden 改为 visible。
- Golden 文件需要显式审阅默认值变化。

## 测试

Core：

- 新页面默认值为 visible。
- page.setOverflow 成功修改 Page Record。
- 缺失记录和非 Page Record 返回结构化诊断。
- no-op 不增加 Store revision 或 History。
- undo/redo 恢复 overflow。
- canonical JSON 保留 overflow。

Editor：

- visible 时越界节点不被 Page Board 裁剪。
- hidden 时越界节点被 Page Board 裁剪。
- Core 事务更新后 Page Board 样式同步。

Playground 与 E2E：

- 切换按钮状态与 Page Record 一致。
- 切换 visible/hidden 后画布效果立即变化。
- undo/redo 同步恢复画布效果和按钮状态。
- 导出的 JSON 包含当前 overflow。
- 更新并审阅相关 Golden。

## 非目标

- 不新增独立的编辑器越界显示偏好。
- 不改变 Workspace、viewport 或 selection 的 Session Scope 边界。
- 不实现复杂遮罩、任意形状裁剪或多画板裁剪。
- 不删除 scroll 枚举值。
