# Operation Log System Design

## Goal

Add a durable operation logging system to ComposeUI so every meaningful editor interaction can be inspected later, replayed deterministically, and used to identify the first point where actual behavior diverges from expected behavior.

The Output panel becomes the user-facing operation console. Logs remain independent from the project document and can be exported as a standalone diagnostic bundle.

## Decisions

- Persist logs locally across refreshes.
- Capture document, history, session, workspace, diagnostic, and selected high-frequency interaction events.
- Prioritize deterministic state replay over pixel-perfect pointer playback.
- Export logs as an independent bundle rather than embedding them in project documents.
- Record semantic commands as replay input and transaction patches plus state hashes as verification output.
- Keep the implementation framework-neutral so the same service can be injected from React, Vue 2, Vue 3, Angular, or a direct DOM host.

## Relationship To History

Operation logging does not replace the existing `History` timeline.

`History` owns the current editable undo/redo branch. Jumping backward and issuing a new command may discard the abandoned future branch from History.

The operation log is an append-only record of what occurred. Undo, redo, history jumps, failed commands, and abandoned branches remain in the log. History entries and operation events are correlated through `transactionId`.

## Package And Dependency Boundaries

Create a framework-neutral `@composeui/operation-log` package with four primary responsibilities:

- `OperationRecorder` accepts normalized events, assigns ordering and causal metadata, applies redaction and coalescing, and publishes query updates.
- `OperationLogStore` is a persistence port with in-memory and IndexedDB adapters.
- `ReplayEngine` restores a checkpoint in an isolated runtime, replays events, and reports deterministic differences.
- `LogBundleCodec` validates, migrates, imports, and exports standalone log bundles.

Integration boundaries are narrow event sinks rather than direct storage dependencies:

- `@composeui/core` declares a narrow `EditorOperationObserver` port and emits command attempts, successes, failures, undo, redo, and history jumps through it.
- editor session emits selection, active tool, viewport, and tree disclosure changes.
- workspace emits panel activation, layout changes, restoration failures, and panel failures.
- Output subscribes to the operation-log query API and does not access IndexedDB directly.
- framework adapters create and inject the same operation-log service without implementing logging rules.

The dependency direction is one-way: `@composeui/operation-log` may depend on public core types and implement the core observer port, while core never imports the operation-log package. Core remains usable and testable in Node.js and never depends on a browser persistence adapter.

## Event Model

Every event uses a versioned envelope:

```ts
interface OperationEvent<TPayload> {
  schemaVersion: 1
  eventId: string
  sessionId: string
  projectId: string
  sequence: number
  timestamp: string
  category: "document" | "history" | "session" | "workspace" | "diagnostic" | "system"
  type: string
  status: "observed" | "started" | "succeeded" | "failed"
  transactionId?: string
  causationId?: string
  payload: TPayload
  diagnostics?: Diagnostic[]
  beforeHash?: string
  afterHash?: string
}
```

`sequence` is strictly increasing within a session and is the authoritative replay order. Wall-clock timestamps are informational and may not be used for ordering.

Initial event families are:

- `document.command`: command ID and structured payload; successful events include forward and inverse patches and before/after state hashes.
- `history.undo`, `history.redo`, and `history.jump`: target transaction and timeline position.
- `session.selection`, `session.tool`, `session.viewport`, and `session.treeDisclosure`: editor session state changes.
- `workspace.panel` and `workspace.layout`: panel activation, movement, collapse, and restoration.
- `diagnostic.reported`: command validation, listener, persistence, replay, and panel failures.
- `system.sessionStarted`, `system.checkpoint`, and `system.sessionEnded`: lifecycle and replay boundaries.

Command attempts are logged before preparation and transaction execution so failed operations are retained. A successful command event contains the original command, resulting patch, transaction ID, and hashes. A failed command event contains the sanitized command and structured diagnostics.

All payloads must be structured-cloneable and serializable. DOM nodes, functions, cyclic objects, and raw thrown values are forbidden.

## Causality And Idempotency

Every event has a globally unique `eventId`. Retries preserve the same ID, allowing stores to reject duplicates safely.

`causationId` links derived events to their initiating event. For example, a pointer drag can cause a `document.command` event, which then causes a transaction and Output update. `transactionId` links commands to History without making History the event source.

Recorder failures must not recursively produce an unbounded chain of diagnostic events. Internal persistence failures use a guarded diagnostic channel with rate limiting and a terminal degraded state.

## High-Frequency Events

Document commands are never sampled or discarded.

Pointer movement, viewport panning, zooming, and drag previews can generate high event volumes. The recorder preserves interaction start and end events, coalesces intermediate values in a configurable time window, and records the final exact state. Coalesced events retain their input count and time range so Output can display summaries such as `画布平移 28 次`.

Deterministic document replay depends on the final semantic command, not intermediate pointer samples.

## Privacy And Redaction

A configurable redactor runs before persistence and export. The default policy retains node IDs, names, dimensions, coordinates, command payloads, patches, and diagnostics required for replay.

The default policy removes or masks credentials, authorization data, URL query parameters, local filesystem paths outside approved project-relative paths, resource contents, and host-provided sensitive metadata.

Redaction occurs before data reaches IndexedDB. Export applies redaction again so a host can enforce a stricter sharing policy than its local policy.

## Canonical Hashing

State hashes are calculated from a canonical document representation:

- object keys use deterministic ordering;
- records use stable identity ordering;
- unsupported values are rejected rather than stringified implicitly;
- session and workspace state are hashed separately from the project document;
- the hash algorithm and canonicalization version are stored in the bundle manifest.

Hash comparison detects divergence cheaply. Patch comparison produces the human-readable field-level difference when a mismatch occurs.

## Persistence

The default browser adapter uses IndexedDB with four object stores:

- `sessions`: session metadata, project ID, product versions, start/end time, event count, and final hash.
- `events`: append-only events keyed by `[sessionId, sequence]`, with indexes required by Output filters.
- `checkpoints`: document and session snapshots keyed by session and sequence.
- `metadata`: database schema version, migration state, and storage statistics.

Critical events such as document command results, failures, undo, redo, and history jumps are queued immediately. Ordinary UI events may be written in short batches while retaining assigned sequence order.

The adapter flushes pending batches when the page becomes hidden, when the project changes, and during orderly workspace disposal. Browser shutdown is not guaranteed, so an unclosed session is detected on the next startup and labeled as abnormally ended.

IndexedDB failure never blocks editing. The recorder retries transient failures, enters a degraded state after its retry budget is exhausted, retains a bounded in-memory tail where possible, and exposes a visible diagnostic in Output.

## Checkpoints And Retention

A checkpoint is created after either 100 document events or 30 seconds since the previous checkpoint, whichever occurs first. Both thresholds are host-configurable.

Each checkpoint stores a full canonical document snapshot, replay-relevant session state, sequence, and hashes. Events after the checkpoint remain append-only.

Default local retention is 50 MB per project or 30 days. Cleanup removes the oldest completed sessions first while preserving the current session, its latest valid checkpoint, and at least the most recent complete session. Exported bundles are not affected by local retention.

## Log Bundle

The standalone log bundle contains:

- a versioned manifest;
- product, schema, hash, browser, platform, plugin, and feature versions;
- the initial snapshot and subsequent checkpoints;
- ordered operation events;
- redaction-policy metadata and integrity hashes.

Import validates bundle size, schema support, sequence continuity, event identity, checkpoint hashes, hash-chain integrity, and supported command/event types before replay becomes available.

Imported data is untrusted. It cannot contain executable handlers, invoke arbitrary code, access the active project, perform network requests, or write through host resource adapters.

## Deterministic Replay

Replay always runs in an isolated editor instance and never mutates the active project.

To reach a target event, ReplayEngine:

1. validates the bundle and environment metadata;
2. selects the nearest valid checkpoint at or before the target;
3. creates isolated core, session, and workspace state;
4. executes document commands and history operations in sequence order;
5. compares command outcome, diagnostics, patch, and state hash after every deterministic event;
6. applies replayable session and workspace events;
7. pauses at the target and exposes the reconstructed state and event context.

Supported modes are single-step, run-to-event, continuous playback, and headless verification. Continuous playback may use original relative timing or a fixed speed. Headless verification stops at the first mismatch.

Replay disables saving, network requests, uploads, external resource mutation, and other host side effects.

## Replay Differences

Replay reports typed differences:

- `command-mismatch`: success, failure, or diagnostics differ.
- `patch-mismatch`: affected records or fields differ.
- `state-hash-mismatch`: canonical final state differs.
- `missing-handler`: the current runtime does not recognize an event.
- `schema-incompatible`: the bundle cannot be migrated safely.
- `environment-mismatch`: required product, plugin, or feature versions differ.

The default response is to pause at the first difference and display expected value, actual value, first differing field, and adjacent events. A user may continue in best-effort mode, but all subsequent results are marked non-deterministic.

## Output Panel

The Output panel becomes a compact operation console using existing theme tokens and colors.

Its toolbar contains:

- clear current view without deleting persisted events;
- log-level filters for operation, information, warning, and error;
- category filters for document, history, session, workspace, and diagnostics;
- text search across command ID, node name, transaction ID, and diagnostic code;
- auto-scroll toggle;
- import, export, and replay actions.

Each virtualized row displays time, status icon, localized summary, and key parameters. Examples include coordinate transitions for moves and dimensions for resizes. Failed events display their diagnostic code and error state. Coalesced UI events render as one expandable group.

Selecting a row opens structured details containing payload, patch, hashes, transaction ID, causal links, and diagnostics. The detail view supports copying one event and starting replay from that point.

Localized summaries come from a formatter registry. Persisted events contain semantic data rather than translated presentation strings, avoiding log migration when language changes.

## Error Handling

- Logging and persistence errors never fail an editor command.
- Event subscribers are isolated so one faulty consumer cannot block other consumers.
- Storage retries preserve `eventId` and sequence ordering.
- Quota and migration errors are visible in Output and available through the diagnostic API.
- Invalid imported bundles fail closed and remain unavailable to ReplayEngine.
- Unknown newer events may be displayed as raw structured data but cannot participate in deterministic replay without a registered handler.

## Delivery Phases

Phase one includes:

- event contracts, recorder, canonical hashing, and in-memory store;
- document command success/failure, undo, redo, and history-jump capture;
- selection, active-tool, and viewport capture;
- IndexedDB persistence, checkpoints, retention, and export;
- Output filtering, search, details, and virtualized rows;
- isolated single-step, run-to-event, and headless deterministic replay.

Phase two adds complete workspace layout capture, richer interaction sampling, imported-bundle management, and continuous visual playback.

## Testing

Unit tests cover event ordering, idempotency, coalescing, redaction, canonical hashing, storage retry, retention, and schema migration.

Core integration tests cover successful and failed instances of every command, transaction correlation, patches and hashes, and undo/redo/jump events without changing existing History behavior.

Replay tests prove that original and reconstructed documents are identical and that altered commands, patches, hashes, sequence numbers, or checkpoints produce the expected typed difference.

IndexedDB tests cover refresh restoration, interrupted batches, quota failure, duplicate retries, cleanup, and database upgrades.

Editor tests cover Output filtering, search, details, localization formatters, virtual scrolling, import errors, and degraded-state diagnostics.

End-to-end tests perform create, move, resize, rename, undo, redo, and history jump operations; reload the application; reload the persisted log; and complete deterministic replay.

Performance tests verify that ordinary command recording does not add synchronous storage work to the interaction path and that high-frequency UI input is coalesced rather than persisted event by event.

## Non-Goals

- Replacing the existing undo/redo History implementation.
- Embedding operation history in project documents.
- Treating the operation log as a collaboration protocol.
- Recording screenshots, video, or every raw pointer event.
- Guaranteeing exact visual playback across different product or plugin versions.
- Uploading logs to a server in phase one.
- Allowing replay to invoke host side effects.
