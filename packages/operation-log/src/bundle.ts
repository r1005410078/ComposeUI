import type { OperationCheckpoint } from "./checkpoints"
import type { OperationEvent } from "./events"
import { canonicalJson, hashCanonical } from "./canonical"
import { defaultRedactor } from "./redaction"
import type { OperationLifecycleStore } from "./store"
import type { OperationSession } from "./sessions"

export const DEFAULT_LOG_BUNDLE_MAX_BYTES = 50 * 1024 * 1024

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

export interface ExportLogBundleOptions {
  sessionId: string
  productVersion: string
  exportedAt?: string
  redactor?: <T>(value: T) => T
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
  const redactedSession = structuredClone(redactor(structuredClone(session)))
  const redactedCheckpoints = structuredClone(redactor(structuredClone(checkpoints)))
  const redactedEvents = structuredClone(redactor(structuredClone(events)))
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
      typeof sectionHashes.session !== "string" ||
      typeof sectionHashes.checkpoints !== "string" ||
      typeof sectionHashes.events !== "string" ||
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
    return structuredClone({ manifest, session, checkpoints, events }) as unknown as LogBundleV1
  } catch (error) {
    if (error instanceof Error && error.message === "LOG_BUNDLE_INTEGRITY_FAILED") throw error
    throw integrityError()
  }
}

function validateBundleContents(
  session: OperationSession,
  checkpoints: OperationCheckpoint[],
  events: OperationEvent[],
  manifest: Record<string, unknown>,
): void {
  if (manifest.sessionId !== session.sessionId || session.eventCount !== events.length)
    throw integrityError()
  const ids = new Set<string>()
  events.forEach((event, index) => {
    if (
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
