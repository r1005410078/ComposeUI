import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "@composeui/core"
import type { OperationEvent, OperationSession, OperationLifecycleStore } from "../src/index"
import {
  MemoryOperationLogStore,
  canonicalJson,
  exportLogBundle,
  hashCanonical,
  importLogBundle,
} from "../src/index"

const session: OperationSession = {
  sessionId: "s1",
  projectId: "p1",
  status: "ended",
  startedAt: "2026-07-13T00:00:00.000Z",
  endedAt: "2026-07-13T00:01:00.000Z",
  eventCount: 2,
  finalHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}

const event = (sequence: number, eventId = `e${sequence}`): OperationEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId: "s1",
  projectId: "p1",
  sequence,
  timestamp: `2026-07-13T00:00:0${sequence}.000Z`,
  category: "document",
  type: sequence === 1 ? "node.create" : "node.move",
  status: "succeeded",
  payload: { nodeId: "node-1", token: "secret" },
})

async function seededStore(): Promise<MemoryOperationLogStore> {
  const store = new MemoryOperationLogStore()
  const document = createEmptyDocument({ documentId: "document-1", pageId: "page-1" })
  const sessionState = { selection: { nodeId: "node-1" } }
  await store.putSession(session)
  await store.append([event(1), event(2)])
  await store.putCheckpoint({
    sessionId: "s1",
    sequence: 2,
    createdAt: "2026-07-13T00:01:00.000Z",
    document,
    sessionState,
    documentHash: await hashCanonical(document),
    sessionHash: await hashCanonical(sessionState),
  })
  return store
}

async function seededStoreWithWorkspace(): Promise<MemoryOperationLogStore> {
  const store = await seededStore()
  const checkpoint = await store.getNearestCheckpoint("s1", 2)
  if (checkpoint === undefined) throw new Error("checkpoint missing")
  const workspaceState = { panels: { inspector: true } }
  await store.putCheckpoint({
    ...checkpoint,
    workspaceState,
    workspaceHash: await hashCanonical(workspaceState),
  })
  return store
}

async function rewriteBundle(
  encoded: string,
  mutate: (bundle: Record<string, any>) => void,
): Promise<string> {
  const bundle = JSON.parse(encoded) as Record<string, any>
  mutate(bundle)
  bundle.manifest.sectionHashes = {
    session: await hashCanonical(bundle.session),
    checkpoints: await hashCanonical(bundle.checkpoints),
    events: await hashCanonical(bundle.events),
  }
  const { manifestHash: _oldManifestHash, ...manifestWithoutHash } = bundle.manifest
  bundle.manifest = {
    ...manifestWithoutHash,
    manifestHash: await hashCanonical(manifestWithoutHash),
  }
  return canonicalJson(bundle)
}

describe("log bundles", () => {
  it("round-trips a redacted bundle", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
      exportedAt: "2026-07-13T00:02:00.000Z",
    })

    const bundle = await importLogBundle(encoded)

    expect(bundle.manifest.bundleVersion).toBe(2)
    if (bundle.manifest.bundleVersion !== 2) throw new Error("expected v2 bundle")
    expect(bundle.manifest.schemaVersion).toBe(2)
    expect(bundle.manifest.productVersion).toBe("0.0.0")
    expect(bundle.manifest.canonicalization).toEqual({ algorithm: "canonical-json", version: 1 })
    expect(bundle.manifest.redaction).toEqual({ policy: "default-v1", version: 1 })
    expect(bundle.manifest.integrity).toMatchObject({ eventCount: 2, checkpointCount: 1 })
    expect(bundle.events).toHaveLength(2)
    expect(bundle.events[0]?.payload).toMatchObject({ token: "[REDACTED]" })
    expect(bundle.manifest.integrity.chainHash).not.toBe(bundle.manifest.sectionHashes.events)
  })

  it("round-trips a checkpoint workspace snapshot", async () => {
    const encoded = await exportLogBundle(await seededStoreWithWorkspace(), {
      sessionId: "s1",
      productVersion: "0.0.0",
      exportedAt: "2026-07-13T00:02:00.000Z",
    })

    const bundle = await importLogBundle(encoded)

    expect(bundle.checkpoints[0]).toMatchObject({
      workspaceState: { panels: { inspector: true } },
      workspaceHash: await hashCanonical({ panels: { inspector: true } }),
    })
  })

  it("recomputes a workspace hash after checkpoint redaction", async () => {
    const redactedWorkspaceState = { panels: { inspector: "[REDACTED]" } }
    const encoded = await exportLogBundle(await seededStoreWithWorkspace(), {
      sessionId: "s1",
      productVersion: "0.0.0",
      redactor: <T>(value: T): T => {
        if (!Array.isArray(value)) return structuredClone(value)
        return value.map((item) =>
          typeof item === "object" && item !== null && "workspaceState" in item
            ? { ...item, workspaceState: redactedWorkspaceState }
            : item,
        ) as T
      },
    })

    const bundle = await importLogBundle(encoded)

    expect(bundle.checkpoints[0]).toMatchObject({
      workspaceState: redactedWorkspaceState,
      workspaceHash: await hashCanonical(redactedWorkspaceState),
    })
  })

  it("imports the legacy V1 bundle emitted before the V2 manifest", async () => {
    const legacySession = {
      sessionId: "legacy-session",
      projectId: "legacy-project",
      status: "ended",
      startedAt: "2026-07-13T00:00:00.000Z",
      endedAt: "2026-07-13T00:01:00.000Z",
      eventCount: 1,
      finalHash: "final",
    }
    const legacyEvents = [
      {
        schemaVersion: 1,
        eventId: "legacy-event",
        sessionId: "legacy-session",
        projectId: "legacy-project",
        sequence: 1,
        timestamp: "2026-07-13T00:00:01.000Z",
        category: "document",
        type: "node.create",
        status: "succeeded",
        payload: {},
      },
    ]
    const legacyDocument = createEmptyDocument({ documentId: "document-1", pageId: "page-1" })
    const legacyCheckpoints = [
      {
        sessionId: "legacy-session",
        sequence: 1,
        createdAt: "2026-07-13T00:01:00.000Z",
        document: legacyDocument,
        sessionState: {},
        documentHash: "document",
        sessionHash: "session",
      },
    ]
    const sectionHashes = {
      session: await hashCanonical(legacySession),
      checkpoints: await hashCanonical(legacyCheckpoints),
      events: await hashCanonical(legacyEvents),
    }
    const manifestWithoutHash = {
      bundleVersion: 1 as const,
      schemaVersion: 1 as const,
      hashAlgorithm: "SHA-256" as const,
      sessionId: "legacy-session",
      productVersion: "0.0.0",
      exportedAt: "2026-07-13T00:02:00.000Z",
      sectionHashes,
    }
    const legacy = canonicalJson({
      manifest: {
        ...manifestWithoutHash,
        manifestHash: await hashCanonical(manifestWithoutHash),
      },
      session: legacySession,
      checkpoints: legacyCheckpoints,
      events: legacyEvents,
    })

    const bundle = await importLogBundle(legacy)

    expect(bundle.manifest.bundleVersion).toBe(1)
    if (bundle.manifest.bundleVersion !== 1) throw new Error("expected legacy bundle")
    expect(bundle.manifest.sectionHashes.events).toBe(sectionHashes.events)

    const unknownFieldBundle = JSON.parse(legacy) as Record<string, any>
    unknownFieldBundle.session.unexpected = true
    unknownFieldBundle.manifest.sectionHashes.session = await hashCanonical(
      unknownFieldBundle.session,
    )
    const unknownManifestWithoutHash = {
      ...unknownFieldBundle.manifest,
      manifestHash: undefined,
    }
    delete unknownManifestWithoutHash.manifestHash
    unknownFieldBundle.manifest.manifestHash = await hashCanonical(unknownManifestWithoutHash)
    await expect(importLogBundle(canonicalJson(unknownFieldBundle))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })

  it("rejects tampering with section contents", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })

    await expect(importLogBundle(encoded.replace("node.create", "node.delete"))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })

  it("rechecks checkpoint hashes and the event hash chain on import", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })
    const invalidCheckpointHash = await rewriteBundle(encoded, (bundle) => {
      bundle.checkpoints[0].documentHash =
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    })
    await expect(importLogBundle(invalidCheckpointHash)).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )

    const invalidChain = await rewriteBundle(encoded, (bundle) => {
      bundle.events[0].payload.nodeId = "changed"
    })
    await expect(importLogBundle(invalidChain)).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")
  })

  it("rejects incomplete, mismatched, and unknown checkpoint workspace fields", async () => {
    const encoded = await exportLogBundle(await seededStoreWithWorkspace(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })

    const missingHash = await rewriteBundle(encoded, (bundle) => {
      delete bundle.checkpoints[0].workspaceHash
    })
    await expect(importLogBundle(missingHash)).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")

    const missingState = await rewriteBundle(encoded, (bundle) => {
      delete bundle.checkpoints[0].workspaceState
    })
    await expect(importLogBundle(missingState)).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")

    const mismatchedHash = await rewriteBundle(encoded, (bundle) => {
      bundle.checkpoints[0].workspaceHash =
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    })
    await expect(importLogBundle(mismatchedHash)).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")

    const unknownField = await rewriteBundle(encoded, (bundle) => {
      bundle.checkpoints[0].unexpected = true
    })
    await expect(importLogBundle(unknownField)).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")
  })

  it("rejects invalid event order, duplicate IDs, and checkpoint ranges", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })
    const bundle = JSON.parse(encoded) as Record<string, unknown>
    const events = bundle.events as Array<Record<string, unknown>>
    events[1]!.sequence = 3
    await expect(importLogBundle(JSON.stringify(bundle))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )

    const duplicate = JSON.parse(encoded) as Record<string, unknown>
    const duplicateEvents = duplicate.events as Array<Record<string, unknown>>
    duplicateEvents[1]!.eventId = duplicateEvents[0]!.eventId
    await expect(importLogBundle(JSON.stringify(duplicate))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )

    const checkpoint = JSON.parse(encoded) as Record<string, unknown>
    const checkpoints = checkpoint.checkpoints as Array<Record<string, unknown>>
    checkpoints[0]!.sequence = 3
    await expect(importLogBundle(JSON.stringify(checkpoint))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })

  it("enforces the encoded byte limit", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })

    await expect(importLogBundle(encoded, { maxBytes: 1 })).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })

  it("rejects malformed source session and event schemas before export", async () => {
    const malformedEvent = { ...event(1), timestamp: "yesterday" }
    const store = {
      getSession: async () => ({ ...session, eventCount: 1 }),
      query: async () => [malformedEvent],
      getNearestCheckpoint: async () => undefined,
    } as unknown as OperationLifecycleStore

    await expect(
      exportLogBundle(store, { sessionId: "s1", productVersion: "0.0.0" }),
    ).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")
  })

  it("exports a sequence-zero checkpoint even when the session has no events", async () => {
    const store = new MemoryOperationLogStore()
    const emptySession: OperationSession = {
      ...session,
      status: "ended",
      endedAt: "2026-07-13T00:01:00.000Z",
      eventCount: 0,
    }
    const document = createEmptyDocument({ documentId: "document-1", pageId: "page-1" })
    const sessionState = { selection: [] }
    await store.putSession(emptySession)
    await store.putCheckpoint({
      sessionId: "s1",
      sequence: 0,
      createdAt: "2026-07-13T00:00:00.000Z",
      document,
      sessionState,
      documentHash: await hashCanonical(document),
      sessionHash: await hashCanonical(sessionState),
    })

    const bundle = await importLogBundle(
      await exportLogBundle(store, { sessionId: "s1", productVersion: "0.0.0" }),
    )

    expect(bundle.events).toEqual([])
    expect(bundle.checkpoints).toHaveLength(1)
    expect(bundle.checkpoints[0]?.sequence).toBe(0)
    expect(bundle.manifest.integrity.initialSnapshotHash).toBeDefined()
  })

  it("rejects malformed document records and diagnostics before export", async () => {
    const invalidEvent = {
      ...event(1),
      diagnostics: [{ code: "BAD", severity: "error", message: 42 }],
    }
    const invalidCheckpoint = {
      sessionId: "s1",
      sequence: 1,
      createdAt: "2026-07-13T00:01:00.000Z",
      document: {
        schemaVersion: 1,
        rootPageId: "page-1",
        records: [
          {
            id: "document-1",
            revision: 0,
            typeName: "document",
            schemaVersion: 1,
            rootPageId: "page-1",
          },
          {
            id: "page-1",
            revision: 0,
            typeName: "page",
            name: "Page 1",
            width: 100,
            height: 100,
            background: "#fff",
            overflow: "visible",
            layout: { mode: "free" },
            unexpected: true,
          },
        ],
      },
      sessionState: { selection: [] },
      documentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sessionHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }
    const storeWithInvalidData = {
      getSession: async () => session,
      query: async () => [invalidEvent],
      getNearestCheckpoint: async () => invalidCheckpoint,
    } as unknown as OperationLifecycleStore

    await expect(
      exportLogBundle(storeWithInvalidData, { sessionId: "s1", productVersion: "0.0.0" }),
    ).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")
  })

  it("rejects bundles with missing required runtime schema fields", async () => {
    await expect(
      importLogBundle(
        JSON.stringify({
          manifest: { schemaVersion: 1, bundleVersion: 1, hashAlgorithm: "SHA-256" },
          session: {},
          checkpoints: [],
          events: [],
        }),
      ),
    ).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")
  })
})
