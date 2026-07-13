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

export interface LogBundleV1 {
  manifest: LogBundleManifestV1
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
  const redactedSession = structuredClone(redactor(structuredClone(session)))
  const redactedCheckpoints = structuredClone(redactor(structuredClone(checkpoints)))
  const redactedEvents = structuredClone(redactor(structuredClone(events)))
  validateBundleContents(structuredClone(redactedSession), redactedCheckpoints, redactedEvents, {
    sessionId: options.sessionId,
  })
  const sectionHashes = {
    session: await hashCanonical(redactedSession),
    checkpoints: await hashCanonical(redactedCheckpoints),
    events: await hashCanonical(redactedEvents),
  }
  const manifestWithoutHash = {
    bundleVersion: 1 as const,
    schemaVersion: 1 as const,
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
      chainHash: sectionHashes.events,
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
): Promise<LogBundleV1> {
  enforceByteLimit(encoded, options.maxBytes ?? DEFAULT_LOG_BUNDLE_MAX_BYTES)
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!isRecord(parsed)) throw integrityError()
    if (canonicalJson(parsed) !== encoded) throw integrityError()
    const manifest = parsed.manifest
    if (!isRecord(manifest)) throw integrityError()
    if (
      manifest.bundleVersion !== 1 ||
      manifest.schemaVersion !== 1 ||
      manifest.hashAlgorithm !== "SHA-256" ||
      typeof manifest.manifestHash !== "string"
    ) {
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
    validateManifest(manifest, session as Record<string, unknown>, checkpoints, events)
    return structuredClone({ manifest, session, checkpoints, events }) as unknown as LogBundleV1
  } catch (error) {
    if (error instanceof Error && error.message === "LOG_BUNDLE_INTEGRITY_FAILED") throw error
    throw integrityError()
  }
}

function validateBundleContents(
  session: unknown,
  checkpoints: unknown,
  events: unknown,
  manifest: Record<string, unknown>,
): void {
  if (!isSession(session) || !Array.isArray(checkpoints) || !Array.isArray(events)) {
    throw integrityError()
  }
  if (manifest.sessionId !== session.sessionId || session.eventCount !== events.length)
    throw integrityError()
  const ids = new Set<string>()
  events.forEach((event: unknown, index) => {
    if (
      !isEvent(event) ||
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
      !isCheckpoint(checkpoint) ||
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

function validateManifest(
  manifest: Record<string, unknown>,
  session: Record<string, unknown>,
  checkpoints: unknown[],
  events: unknown[],
): void {
  if (
    !isId(manifest.sessionId) ||
    typeof manifest.productVersion !== "string" ||
    !isTimestamp(manifest.exportedAt) ||
    !isRecord(manifest.canonicalization) ||
    manifest.canonicalization.algorithm !== "canonical-json" ||
    manifest.canonicalization.version !== 1 ||
    !isRecord(manifest.redaction) ||
    typeof manifest.redaction.policy !== "string" ||
    manifest.redaction.version !== 1 ||
    !isRecord(manifest.runtime) ||
    !isRecord(manifest.integrity) ||
    manifest.integrity.eventCount !== events.length ||
    manifest.integrity.checkpointCount !== checkpoints.length ||
    !isHash(manifest.integrity.chainHash) ||
    manifest.integrity.chainHash !== (manifest.sectionHashes as Record<string, unknown>).events
  ) {
    throw integrityError()
  }
  const initial = manifest.integrity.initialSnapshotHash
  if (initial !== undefined && !isHash(initial)) throw integrityError()
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

function isSession(value: unknown): value is OperationSession {
  if (!isRecord(value)) return false
  return (
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
    (value.finalHash === undefined || isHash(value.finalHash))
  )
}

function isEvent(value: unknown): value is OperationEvent {
  if (!isRecord(value)) return false
  return (
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
    (value.beforeHash === undefined || isHash(value.beforeHash)) &&
    (value.afterHash === undefined || isHash(value.afterHash)) &&
    (value.diagnostics === undefined || Array.isArray(value.diagnostics))
  )
}

function isCheckpoint(value: unknown): value is OperationCheckpoint {
  if (!isRecord(value)) return false
  return (
    isId(value.sessionId) &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isTimestamp(value.createdAt) &&
    isRecord(value.document) &&
    value.document.schemaVersion === 1 &&
    isId(value.document.rootPageId) &&
    Array.isArray(value.document.records) &&
    Object.hasOwn(value, "sessionState") &&
    isHash(value.documentHash) &&
    isHash(value.sessionHash)
  )
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
