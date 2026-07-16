/**
 * @module schema
 *
 * 持久化文档的类型契约与空文档工厂。
 *
 * 边界：
 * - 这里的类型描述可序列化、可进 `PageDocument` 的权威数据（Document Scope）。
 * - 视口、选中、hover、交互模式等会话态不在此模块。
 * - M0/M1 仅支持单 page + Free Layout + rectangle 节点；auto/grid 与业务组件类型尚未进入 schema。
 *
 * 数据流：`createEmptyDocument` / 宿主导入 → `RecordStore.fromDocument` → 事务与命令读写。
 */

/** 所有权威 record 共有的稳定身份与乐观并发版本。 */
export interface BaseRecord {
  /** 全局稳定 ID；事务内不可改。 */
  id: string
  /**
   * 业务字段变更时递增；身份字段（id/typeName）不变。
   * 无业务 diff 时不 bump，避免无意义 history 条目。
   */
  revision: number
}

/** 文档根记录：每个 PageDocument 恰好一条。 */
export interface DocumentRecord extends BaseRecord {
  typeName: "document"
  schemaVersion: 1
  /** 指向唯一根 page 的 id。 */
  rootPageId: string
}

/**
 * 画板（page board）记录：持久化的页面边界。
 * width/height/background/overflow 属于运行时页面，不属于编辑器 workspace 会话。
 */
export interface PageRecord extends BaseRecord {
  typeName: "page"
  name: string
  width: number
  height: number
  background: string
  overflow: "visible" | "hidden" | "scroll"
  /** M1 仅 free；切换 layout mode 将来必须走显式迁移事务。 */
  layout: { mode: "free" }
}

/**
 * 父级局部坐标系下的 Free Layout 盒。
 * 坐标不是 workspace/world；editor 层负责 world ↔ parent-local 转换。
 */
export interface FreeLayout {
  mode: "free"
  x: number
  y: number
  width: number
  height: number
}

/**
 * 树节点记录。M1 仅 rectangle；parentId 指向 page 或 node，禁止成环。
 * index 为同级排序键（字符串），同 parent 下必须唯一。
 */
export interface NodeRecord extends BaseRecord {
  typeName: "node"
  nodeType: "rectangle"
  name: string
  parentId: string
  index: string
  layout: FreeLayout
  visible: boolean
  locked: boolean
  props: { fill: string }
}

/** 可进入 Store / 事务的权威 record 联合。 */
export type PersistentRecord = DocumentRecord | PageRecord | NodeRecord
/** 编辑器侧对持久 record 的别名（与 PersistentRecord 同形）。 */
export type EditorRecord = PersistentRecord

/**
 * 按 typeName 约束的可更新字段补丁。
 * 刻意排除 id / typeName / revision，防止身份字段被业务补丁改写。
 */
export type RecordUpdatePatch<T extends PersistentRecord["typeName"]> = Partial<
  Omit<Extract<PersistentRecord, { typeName: T }>, "id" | "typeName" | "revision">
>

/**
 * 宿主可保存/加载的完整页面文档快照。
 * 与 canonical JSON golden、导出、operation log before/after 对齐。
 */
export interface PageDocument {
  schemaVersion: 1
  rootPageId: string
  records: EditorRecord[]
}

/**
 * 构造最小合法空文档：一条 document + 一条默认 page。
 * 不创建节点；不写会话态。
 */
export function createEmptyDocument(input: { documentId: string; pageId: string }): PageDocument {
  return {
    schemaVersion: 1,
    rootPageId: input.pageId,
    records: [
      {
        id: input.documentId,
        revision: 0,
        typeName: "document",
        schemaVersion: 1,
        rootPageId: input.pageId,
      },
      {
        id: input.pageId,
        revision: 0,
        typeName: "page",
        name: "Page 1",
        width: 1440,
        height: 900,
        background: "#ffffff",
        overflow: "visible",
        layout: { mode: "free" },
      },
    ],
  }
}
