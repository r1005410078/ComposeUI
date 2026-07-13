import type { OperationCheckpoint } from "./checkpoints"
import type { OperationEvent } from "./events"
import { canonicalJson, hashCanonical } from "./canonical"
import { defaultRedactor } from "./redaction"
import type { OperationLifecycleStore } from "./store"
import type { OperationSession } from "./sessions"

export const DEFAULT_LOG_BUNDLE_MAX_BYTES = 50 * 1024 * 1024
const HASH_PATTERN = /^[0-9a-f]{64}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface LogBundleManifestV1 {
  bundleVersion: 1
  schemaVersion: 1
  hashAlgorithm: "SHA-256"
  sessionId: string
  productVersion: string
  exportedAt: string
  sectionHashes: {
    session: string
    checkpoints: string
    events: string
  }
  manifestHash: string
}

export interface LogBundleV1 {
  manifest: LogBundleManifestV1
  session: OperationSession
  checkpoints: OperationCheckpoint[]
  events: OperationEvent[]
}

export interface LogBundleManifestV2 {
  bundleVersion: 2
  schemaVersion: 2
  hashAlgorithm: "SHA-256"
  sessionId: string
  productVersion: string
  exportedAt: string
  canonicalization: {
    algorithm: "canonical-json"
    version: 1
  }
  redaction: {
    policy: string
    version: 1
  }
  runtime: {
    platform?: string
    browser?: string
    plugins?: Record<string, string>
    features?: Record<string, boolean>
  }
  integrity: {
    eventCount: number
    checkpointCount: number
    chainHash: string
    initialSnapshotHash?: string
    firstEventId?: string
    lastEventId?: string
  }
  sectionHashes: {
    session: string
    checkpoints: string
    events: string
  }
  manifestHash: string
}

export interface LogBundleV2 {
  manifest: LogBundleManifestV2
  session: OperationSession
  checkpoints: OperationCheckpoint[]
  events: OperationEvent[]
}

export interface ExportLogBundleOptions {
  sessionId: string
  productVersion: string
  exportedAt?: string
  redactor?: <T>(value: T) => T
  redactionPolicy?: string
  platform?: string
  browser?: string
  plugins?: Record<string, string>
  features?: Record<string, boolean>
  maxBytes?: number
}

export interface ImportLogBundleOptions {
  maxBytes?: number
}

export async function exportLogBundle(
  store: OperationLifecycleStore,
  options: ExportLogBundleOptions,
): Promise<string> {
  const session = await store.getSession(options.sessionId)
  if (session === undefined) throw new Error("LOG_BUNDLE_SESSION_NOT_FOUND")
  const events = await store.query({ sessionId: options.sessionId })
  const checkpoints: OperationCheckpoint[] = []
  const initialCheckpoint = await store.getNearestCheckpoint(options.sessionId, 0)
  if (initialCheckpoint !== undefined) checkpoints.push(initialCheckpoint)
  for (const event of events) {
    const checkpoint = await store.getNearestCheckpoint(options.sessionId, event.sequence)
    if (
      checkpoint !== undefined &&
      !checkpoints.some((item) => item.sequence === checkpoint.sequence)
    ) {
      checkpoints.push(checkpoint)
    }
  }
  const redactor = options.redactor ?? defaultRedactor
  validateBundleContents(session, checkpoints, events, {
    sessionId: options.sessionId,
  })
  await validateCheckpointHashes(checkpoints)
  const redactedSession = structuredClone(redactor(structuredClone(session)))
  const redactedCheckpoints = structuredClone(redactor(structuredClone(checkpoints))).map(
    (checkpoint) => checkpoint,
  )
  const redactedEvents = structuredClone(redactor(structuredClone(events)))
  for (const checkpoint of redactedCheckpoints) {
    checkpoint.documentHash = await hashCanonical(checkpoint.document)
    checkpoint.sessionHash = await hashCanonical(checkpoint.sessionState)
  }
  validateBundleContents(structuredClone(redactedSession), redactedCheckpoints, redactedEvents, {
    sessionId: options.sessionId,
  })
  const sectionHashes = {
    session: await hashCanonical(redactedSession),
    checkpoints: await hashCanonical(redactedCheckpoints),
    events: await hashCanonical(redactedEvents),
  }
  const manifestWithoutHash = {
    bundleVersion: 2 as const,
    schemaVersion: 2 as const,
    hashAlgorithm: "SHA-256" as const,
    sessionId: options.sessionId,
    productVersion: options.productVersion,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    canonicalization: { algorithm: "canonical-json" as const, version: 1 as const },
    redaction: { policy: options.redactionPolicy ?? "default-v1", version: 1 as const },
    runtime: {
      ...(options.platform === undefined ? {} : { platform: options.platform }),
      ...(options.browser === undefined ? {} : { browser: options.browser }),
      ...(options.plugins === undefined ? {} : { plugins: structuredClone(options.plugins) }),
      ...(options.features === undefined ? {} : { features: structuredClone(options.features) }),
    },
    integrity: {
      eventCount: redactedEvents.length,
      checkpointCount: redactedCheckpoints.length,
      chainHash: await computeChainHash(redactedSession, redactedCheckpoints, redactedEvents),
      ...(redactedCheckpoints.find((checkpoint) => checkpoint.sequence === 0) === undefined
        ? {}
        : {
            initialSnapshotHash: await hashCanonical(
              redactedCheckpoints.find((checkpoint) => checkpoint.sequence === 0),
            ),
          }),
      ...(redactedEvents[0] === undefined ? {} : { firstEventId: redactedEvents[0].eventId }),
      ...(redactedEvents.at(-1) === undefined
        ? {}
        : { lastEventId: redactedEvents.at(-1)!.eventId }),
    },
    sectionHashes,
  }
  const manifest = {
    ...manifestWithoutHash,
    manifestHash: await hashCanonical(manifestWithoutHash),
  }
  const encoded = canonicalJson({
    manifest,
    session: redactedSession,
    checkpoints: redactedCheckpoints,
    events: redactedEvents,
  })
  enforceByteLimit(encoded, options.maxBytes ?? DEFAULT_LOG_BUNDLE_MAX_BYTES)
  return encoded
}

export async function importLogBundle(
  encoded: string,
  options: ImportLogBundleOptions = {},
): Promise<LogBundleV1 | LogBundleV2> {
  enforceByteLimit(encoded, options.maxBytes ?? DEFAULT_LOG_BUNDLE_MAX_BYTES)
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!isRecord(parsed)) throw integrityError()
    if (canonicalJson(parsed) !== encoded) throw integrityError()
    const manifest = parsed.manifest
    if (!isRecord(manifest)) throw integrityError()
    if (manifest.bundleVersion === 1 && manifest.schemaVersion === 1) {
      return importLegacyBundle(parsed)
    }
    if (manifest.bundleVersion !== 2 || manifest.schemaVersion !== 2) throw integrityError()
    if (manifest.hashAlgorithm !== "SHA-256" || typeof manifest.manifestHash !== "string") {
      throw integrityError()
    }
    const { manifestHash, ...manifestWithoutHash } = manifest
    if ((await hashCanonical(manifestWithoutHash)) !== manifestHash) throw integrityError()
    const session = parsed.session
    const checkpoints = parsed.checkpoints
    const events = parsed.events
    if (
      !isRecord(manifest.sectionHashes) ||
      !isRecord(session) ||
      !Array.isArray(checkpoints) ||
      !Array.isArray(events)
    ) {
      throw integrityError()
    }
    const sectionHashes = manifest.sectionHashes
    if (
      !isHash(sectionHashes.session) ||
      !isHash(sectionHashes.checkpoints) ||
      !isHash(sectionHashes.events) ||
      (await hashCanonical(session)) !== sectionHashes.session ||
      (await hashCanonical(checkpoints)) !== sectionHashes.checkpoints ||
      (await hashCanonical(events)) !== sectionHashes.events
    ) {
      throw integrityError()
    }
    validateBundleContents(
      session as unknown as OperationSession,
      checkpoints as unknown as OperationCheckpoint[],
      events as unknown as OperationEvent[],
      manifest,
    )
    await validateManifest(manifest, session as Record<string, unknown>, checkpoints, events)
    return structuredClone({ manifest, session, checkpoints, events }) as unknown as LogBundleV2
  } catch (error) {
    if (error instanceof Error && error.message === "LOG_BUNDLE_INTEGRITY_FAILED") throw error
    throw integrityError()
  }
}

async function importLegacyBundle(parsed: Record<string, unknown>): Promise<LogBundleV1> {
  const manifest = parsed.manifest
  const session = parsed.session
  const checkpoints = parsed.checkpoints
  const events = parsed.events
  if (
    !isRecord(manifest) ||
    !isRecord(session) ||
    !Array.isArray(checkpoints) ||
    !Array.isArray(events) ||
    !isLegacyManifest(manifest) ||
    !isHash(manifest.manifestHash)
  ) {
    throw integrityError()
  }
  const { manifestHash, ...manifestWithoutHash } = manifest
  if ((await hashCanonical(manifestWithoutHash)) !== manifestHash) throw integrityError()
  const sectionHashes = manifest.sectionHashes as Record<string, unknown>
  if (
    (await hashCanonical(session)) !== sectionHashes.session ||
    (await hashCanonical(checkpoints)) !== sectionHashes.checkpoints ||
    (await hashCanonical(events)) !== sectionHashes.events
  ) {
    throw integrityError()
  }
  validateBundleContents(session, checkpoints, events, manifest, false)
  return structuredClone({ manifest, session, checkpoints, events }) as unknown as LogBundleV1
}

function isLegacyManifest(value: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(value, [
      "bundleVersion",
      "schemaVersion",
      "hashAlgorithm",
      "sessionId",
      "productVersion",
      "exportedAt",
      "sectionHashes",
      "manifestHash",
    ]) ||
    value.bundleVersion !== 1 ||
    value.schemaVersion !== 1 ||
    value.hashAlgorithm !== "SHA-256" ||
    !isId(value.sessionId) ||
    !isNonEmptyString(value.productVersion) ||
    !isTimestamp(value.exportedAt) ||
    !isRecord(value.sectionHashes) ||
    !hasOnlyKeys(value.sectionHashes, ["session", "checkpoints", "events"])
  ) {
    return false
  }
  return (
    isHash(value.sectionHashes.session) &&
    isHash(value.sectionHashes.checkpoints) &&
    isHash(value.sectionHashes.events)
  )
}

function validateBundleContents(
  session: unknown,
  checkpoints: unknown,
  events: unknown,
  manifest: Record<string, unknown>,
  strictHashes = true,
): void {
  if (!isSession(session, strictHashes) || !Array.isArray(checkpoints) || !Array.isArray(events)) {
    throw integrityError()
  }
  if (manifest.sessionId !== session.sessionId || session.eventCount !== events.length)
    throw integrityError()
  const ids = new Set<string>()
  events.forEach((event: unknown, index) => {
    if (
      !isEvent(event, strictHashes) ||
      event.schemaVersion !== 1 ||
      event.sessionId !== session.sessionId ||
      event.projectId !== session.projectId ||
      event.sequence !== index + 1 ||
      typeof event.eventId !== "string" ||
      ids.has(event.eventId)
    ) {
      throw integrityError()
    }
    ids.add(event.eventId)
  })
  const checkpointSequences = new Set<number>()
  for (const checkpoint of checkpoints) {
    if (
      !isCheckpoint(checkpoint, strictHashes) ||
      checkpoint.sessionId !== session.sessionId ||
      !Number.isInteger(checkpoint.sequence) ||
      checkpoint.sequence < 0 ||
      checkpoint.sequence > events.length ||
      checkpointSequences.has(checkpoint.sequence)
    ) {
      throw integrityError()
    }
    checkpointSequences.add(checkpoint.sequence)
  }
}

async function validateManifest(
  manifest: Record<string, unknown>,
  session: Record<string, unknown>,
  checkpoints: unknown[],
  events: unknown[],
): Promise<void> {
  if (
    !hasOnlyKeys(manifest, [
      "bundleVersion",
      "schemaVersion",
      "hashAlgorithm",
      "sessionId",
      "productVersion",
      "exportedAt",
      "canonicalization",
      "redaction",
      "runtime",
      "integrity",
      "sectionHashes",
      "manifestHash",
    ]) ||
    !isId(manifest.sessionId) ||
    !isNonEmptyString(manifest.productVersion) ||
    !isTimestamp(manifest.exportedAt) ||
    !isRecord(manifest.canonicalization) ||
    manifest.canonicalization.algorithm !== "canonical-json" ||
    manifest.canonicalization.version !== 1 ||
    !isRecord(manifest.redaction) ||
    !isNonEmptyString(manifest.redaction.policy) ||
    manifest.redaction.version !== 1 ||
    !isRecord(manifest.runtime) ||
    !isRecord(manifest.integrity) ||
    manifest.integrity.eventCount !== events.length ||
    manifest.integrity.checkpointCount !== checkpoints.length ||
    !isHash(manifest.integrity.chainHash) ||
    !hasOnlyKeys(manifest.canonicalization, ["algorithm", "version"]) ||
    !hasOnlyKeys(manifest.redaction, ["policy", "version"]) ||
    !hasOnlyKeys(manifest.runtime, ["platform", "browser", "plugins", "features"]) ||
    !hasOnlyKeys(manifest.integrity, [
      "eventCount",
      "checkpointCount",
      "chainHash",
      "initialSnapshotHash",
      "firstEventId",
      "lastEventId",
    ]) ||
    !hasOnlyKeys(manifest.sectionHashes as Record<string, unknown>, [
      "session",
      "checkpoints",
      "events",
    ])
  ) {
    throw integrityError()
  }
  const initial = manifest.integrity.initialSnapshotHash
  if (initial !== undefined && !isHash(initial)) throw integrityError()
  const initialCheckpoint = checkpoints.find(
    (checkpoint) => (checkpoint as OperationCheckpoint).sequence === 0,
  )
  if (
    (initialCheckpoint === undefined && initial !== undefined) ||
    (initialCheckpoint !== undefined && initial !== (await hashCanonical(initialCheckpoint)))
  ) {
    throw integrityError()
  }
  const firstEventId = manifest.integrity.firstEventId
  const lastEventId = manifest.integrity.lastEventId
  if (
    (firstEventId !== undefined && !isId(firstEventId)) ||
    (lastEventId !== undefined && !isId(lastEventId)) ||
    (events.length === 0 && (firstEventId !== undefined || lastEventId !== undefined)) ||
    (events.length > 0 &&
      (firstEventId !== (events[0] as OperationEvent).eventId ||
        lastEventId !== (events.at(-1) as OperationEvent).eventId))
  ) {
    throw integrityError()
  }
  validateMetadataRecord(manifest.runtime, false)
  if (!isHash(manifest.manifestHash)) throw integrityError()
  if (
    !isHash((manifest.sectionHashes as Record<string, unknown>).session) ||
    !isHash((manifest.sectionHashes as Record<string, unknown>).checkpoints) ||
    !isHash((manifest.sectionHashes as Record<string, unknown>).events)
  ) {
    throw integrityError()
  }
  if (!isSession(session)) throw integrityError()
  await validateCheckpointHashes(checkpoints as OperationCheckpoint[])
  if (
    manifest.integrity.chainHash !==
    (await computeChainHash(
      session as unknown as OperationSession,
      checkpoints as unknown as OperationCheckpoint[],
      events as unknown as OperationEvent[],
    ))
  ) {
    throw integrityError()
  }
}

async function validateCheckpointHashes(checkpoints: OperationCheckpoint[]): Promise<void> {
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.documentHash !== (await hashCanonical(checkpoint.document)) ||
      checkpoint.sessionHash !== (await hashCanonical(checkpoint.sessionState))
    ) {
      throw integrityError()
    }
  }
}

async function computeChainHash(
  session: OperationSession,
  checkpoints: OperationCheckpoint[],
  events: OperationEvent[],
): Promise<string> {
  const initialCheckpoint = checkpoints.find((checkpoint) => checkpoint.sequence === 0)
  let previousHash = await hashCanonical({
    chainVersion: 1,
    sessionId: session.sessionId,
    projectId: session.projectId,
    initialSnapshotHash:
      initialCheckpoint === undefined ? null : await hashCanonical(initialCheckpoint),
  })
  for (const event of events) {
    previousHash = await hashCanonical({ previousHash, event })
  }
  return previousHash
}

function validateMetadataRecord(value: Record<string, unknown>, allowUndefined: boolean): void {
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(key)) throw integrityError()
    if (item === undefined && allowUndefined) continue
    if (key === "plugins") {
      if (!isRecord(item) || Object.values(item).some((entry) => typeof entry !== "string")) {
        throw integrityError()
      }
      continue
    }
    if (key === "features") {
      if (!isRecord(item) || Object.values(item).some((entry) => typeof entry !== "boolean")) {
        throw integrityError()
      }
      continue
    }
    if (typeof item !== "string") throw integrityError()
  }
}

function isSession(value: unknown, strictHashes = true): value is OperationSession {
  if (!isRecord(value)) return false
  return (
    hasOnlyKeys(value, [
      "sessionId",
      "projectId",
      "status",
      "startedAt",
      "endedAt",
      "eventCount",
      "finalHash",
    ]) &&
    isId(value.sessionId) &&
    isId(value.projectId) &&
    (value.status === "active" || value.status === "ended" || value.status === "abnormal") &&
    isTimestamp(value.startedAt) &&
    (value.endedAt === undefined || isTimestamp(value.endedAt)) &&
    (value.status !== "ended" || value.endedAt !== undefined) &&
    (value.status !== "active" || value.endedAt === undefined) &&
    typeof value.eventCount === "number" &&
    Number.isSafeInteger(value.eventCount) &&
    value.eventCount >= 0 &&
    (value.finalHash === undefined ||
      (strictHashes ? isHash(value.finalHash) : isNonEmptyString(value.finalHash)))
  )
}

function isEvent(value: unknown, strictHashes = true): value is OperationEvent {
  if (!isRecord(value)) return false
  return (
    hasOnlyKeys(value, [
      "schemaVersion",
      "eventId",
      "sessionId",
      "projectId",
      "sequence",
      "timestamp",
      "category",
      "type",
      "status",
      "transactionId",
      "causationId",
      "payload",
      "diagnostics",
      "beforeHash",
      "afterHash",
    ]) &&
    value.schemaVersion === 1 &&
    isId(value.eventId) &&
    isId(value.sessionId) &&
    isId(value.projectId) &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence > 0 &&
    isTimestamp(value.timestamp) &&
    isCategory(value.category) &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    isStatus(value.status) &&
    Object.hasOwn(value, "payload") &&
    (value.transactionId === undefined || isId(value.transactionId)) &&
    (value.causationId === undefined || isId(value.causationId)) &&
    (value.beforeHash === undefined ||
      (strictHashes ? isHash(value.beforeHash) : isNonEmptyString(value.beforeHash))) &&
    (value.afterHash === undefined ||
      (strictHashes ? isHash(value.afterHash) : isNonEmptyString(value.afterHash))) &&
    (value.diagnostics === undefined ||
      (Array.isArray(value.diagnostics) && value.diagnostics.every(isDiagnostic)))
  )
}

function isCheckpoint(value: unknown, strictHashes = true): value is OperationCheckpoint {
  if (!isRecord(value)) return false
  return (
    hasOnlyKeys(value, [
      "sessionId",
      "sequence",
      "createdAt",
      "document",
      "sessionState",
      "documentHash",
      "sessionHash",
    ]) &&
    isId(value.sessionId) &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isTimestamp(value.createdAt) &&
    isPageDocument(value.document, strictHashes) &&
    Object.hasOwn(value, "sessionState") &&
    isSessionState(value.sessionState) &&
    (strictHashes ? isHash(value.documentHash) : isNonEmptyString(value.documentHash)) &&
    (strictHashes ? isHash(value.sessionHash) : isNonEmptyString(value.sessionHash))
  )
}

function isDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.every(
      (key) => key === "code" || key === "severity" || key === "message" || key === "recordId",
    ) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    (value.recordId === undefined || isId(value.recordId))
  )
}

function isPageDocument(value: unknown, strictSchema = true): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "rootPageId", "records"]) ||
    value.schemaVersion !== 1 ||
    !isId(value.rootPageId)
  )
    return false
  if (!Array.isArray(value.records)) return false
  if (!strictSchema) return value.records.every(isJsonValue)
  const records = value.records
  const ids = new Set<string>()
  let documentCount = 0
  for (const record of records) {
    if (!isRecord(record) || !isId(record.id) || ids.has(record.id)) return false
    if (
      typeof record.revision !== "number" ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 0
    ) {
      return false
    }
    ids.add(record.id)
    if (record.typeName === "document") {
      documentCount += 1
      if (
        record.schemaVersion !== 1 ||
        record.rootPageId !== value.rootPageId ||
        !hasOnlyKeys(record, ["id", "revision", "typeName", "schemaVersion", "rootPageId"])
      ) {
        return false
      }
    } else if (record.typeName === "page") {
      if (!isPageRecord(record)) return false
    } else if (record.typeName === "node") {
      if (!isNodeRecord(record)) return false
    } else {
      return false
    }
  }
  return documentCount === 1
}

function isPageRecord(value: Record<string, unknown>): boolean {
  return (
    hasOnlyKeys(value, [
      "id",
      "revision",
      "typeName",
      "name",
      "width",
      "height",
      "background",
      "overflow",
      "layout",
    ]) &&
    typeof value.name === "string" &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    typeof value.background === "string" &&
    (value.overflow === "visible" || value.overflow === "hidden" || value.overflow === "scroll") &&
    isRecord(value.layout) &&
    hasOnlyKeys(value.layout, ["mode"]) &&
    value.layout.mode === "free"
  )
}

function isNodeRecord(value: Record<string, unknown>): boolean {
  if (
    !hasOnlyKeys(value, [
      "id",
      "revision",
      "typeName",
      "nodeType",
      "name",
      "parentId",
      "index",
      "layout",
      "visible",
      "locked",
      "props",
    ]) ||
    value.nodeType !== "rectangle" ||
    typeof value.name !== "string" ||
    !isId(value.parentId) ||
    typeof value.index !== "string" ||
    typeof value.visible !== "boolean" ||
    typeof value.locked !== "boolean" ||
    !isRecord(value.props) ||
    !hasOnlyKeys(value.props, ["fill"]) ||
    typeof value.props.fill !== "string" ||
    !isRecord(value.layout) ||
    !hasOnlyKeys(value.layout, ["mode", "x", "y", "width", "height"]) ||
    value.layout.mode !== "free"
  ) {
    return false
  }
  return [value.layout.x, value.layout.y, value.layout.width, value.layout.height].every(
    (item) => typeof item === "number" && Number.isFinite(item),
  )
}

function isSessionState(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isJsonValue(value)
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!isRecord(value)) return false
  return Object.values(value).every(isJsonValue)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function isCategory(value: unknown): value is OperationEvent["category"] {
  return (
    value === "document" ||
    value === "history" ||
    value === "session" ||
    value === "workspace" ||
    value === "diagnostic" ||
    value === "system"
  )
}

function isStatus(value: unknown): value is OperationEvent["status"] {
  return value === "observed" || value === "started" || value === "succeeded" || value === "failed"
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value)
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function enforceByteLimit(encoded: string, maxBytes: number): void {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    new TextEncoder().encode(encoded).byteLength > maxBytes
  ) {
    throw integrityError()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function integrityError(): Error {
  return new Error("LOG_BUNDLE_INTEGRITY_FAILED")
}
