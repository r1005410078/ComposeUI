# ComposeUI Agent Guide

This file is the operational contract for coding agents working in this repository. Read it before planning or editing code.

## Project Purpose

ComposeUI is an embeddable visual page composition engine for existing web applications. A host application enables visual editing for selected independent pages, registers its own business components and context, saves a JSON `PageDocument`, and renders that document at runtime.

ComposeUI is not a general low-code platform and is not a Figma replacement. Its core job is page composition, layout, component reuse, host data binding, runtime rendering, and optional collaboration/import extensions.

## Current Status

- Product and architecture design documents exist.
- The first implementation plan exists: [M0 Core Loop](docs/superpowers/plans/2026-07-11-m0-core-loop-implementation.md).
- The M0 Core Loop is implemented on `main`: scaffold, minimal Core transaction path, JSON golden, Playground, and Chromium E2E.
- M1 has not been planned or implemented. Follow the [specification roadmap](docs/superpowers/specs/2026-07-11-specification-roadmap-design.md) before proposing or implementing later milestones.
- Do not claim features are implemented because they appear in design documents.
- Create a separate scoped plan for each milestone and update the roadmap only after its exit criteria pass.

## Source Of Truth

Read the relevant documents before changing architecture or behavior:

- [Project overview](docs/project-overview.md)
- [Main product design](docs/superpowers/specs/2026-07-11-embeddable-visual-page-composer-design.md)
- [Transactional editor microkernel](docs/superpowers/specs/2026-07-11-transactional-editor-microkernel-architecture-design.md)
- [Unity-style component tree](docs/superpowers/specs/2026-07-11-unity-style-component-tree-design.md)
- [Large-screen performance architecture](docs/superpowers/specs/2026-07-11-high-performance-large-screen-architecture-design.md)
- [Yjs collaboration](docs/superpowers/specs/2026-07-11-yjs-collaboration-design.md)
- [Testing and golden files](docs/superpowers/specs/2026-07-11-testing-and-golden-files-strategy.md)
- [Vite Playground](docs/superpowers/specs/2026-07-11-vite-playground-demo-design.md)
- [TypeScript, Bun, and Oxc scaffold](docs/superpowers/specs/2026-07-11-typescript-bun-oxc-scaffold-design.md)
- [Specification roadmap](docs/superpowers/specs/2026-07-11-specification-roadmap-design.md)

If documents conflict, use this priority:

1. Explicit current user instruction.
2. Main product design.
3. Relevant specialized design.
4. Project overview.

Do not silently resolve a material contradiction. Document the decision or ask for direction.

## Non-Negotiable Product Rules

### Embeddable First

- The editor must mount into an existing host application through public APIs.
- The host owns routing, persistence, authentication, authorization, network requests, caching, business services, and asset storage.
- Support controlled mount, update, read-only, save, error, and unmount lifecycles.
- Multiple editor instances on one host page must remain isolated.
- Do not introduce process-wide mutable singletons for selection, history, clipboard, registry, portals, or resources.

### One Framework Per Page Board

- Each page board declares exactly one business component adapter through `PageDocument.runtime.adapterId`.
- Vue, React, Angular, or another business component framework must not coexist inside one page board.
- Framework-independent base nodes may coexist with the selected framework.
- The component palette must filter business components by the active adapter.
- Changing adapter on a populated page requires an explicit migration flow and diagnostics.

### Context Injection At The Root

- Create one framework runtime root per page board.
- Inject store, router, i18n, theme, data, actions, and host services once at that root.
- Never create a framework application root or injector for every business component.
- Business-component portals and teleports must remain under the same logical framework root.

### Style Isolation Boundary

- Shadow DOM isolates only the editor chrome.
- Business components render in host Light DOM and keep host styles and theme behavior.
- Use separate editor and business-component portal roots.
- Editor reset styles must never leak into business-component Light DOM.
- Prefix editor CSS custom properties with `--composeui-`.

### Workspace And Page Board

- The infinite workspace is editor session state.
- The page board is the persisted and rendered page boundary.
- Workspace pan, zoom, viewport, and temporary objects do not belong in runtime `PageDocument`.
- Page board size, background, overflow, node tree, and runtime adapter do belong in `PageDocument`.

## Core Architecture

Use a transactional editor microkernel:

```text
Normalized Reactive Record Store
+ Transaction Engine
+ Command / Query / Projection
+ Plugin Contribution System
+ Compiler Pipeline
+ Ports & Adapters
```

DDD may describe language, policies, and boundaries, but must not create a deep object aggregate containing thousands of nodes.

### Record Store

- Store authoritative editor data as normalized, immutable, serializable records.
- Use stable IDs and explicit references such as `parentId` and `definitionId`.
- Separate persistent Document Scope from ephemeral Session Scope.
- Maintain derived indexes incrementally; indexes are rebuildable and not authoritative.
- UI surfaces must subscribe to narrow records or projections, not complete document snapshots.

### Transactions

- Every authoritative document change happens inside one atomic transaction.
- A transaction validates records and cross-record policies before commit.
- Successful transactions produce forward and inverse patches.
- Failed transactions produce no partial state.
- Related multi-node operations remain one transaction and one undo step.
- Use typed transaction origins for local commands, collaboration, migration, import, repair, and initialization.

### Commands

- Toolbar, keyboard, context menu, component tree, canvas, and plugins call the same command handlers.
- UI code must not implement duplicate document mutation logic.
- Commands return structured results and diagnostics, not strings that UI code must parse.
- Pointer-move previews should use session state or a transaction draft; commit one document transaction on interaction completion.

### Queries And Projections

- Component tree, canvas, property panel, diagnostics, and runtime consume dedicated queries/projections.
- Do not scan the entire store during small updates.
- Invalidate only projections affected by a record patch.
- `RenderPlan` is a compiled projection, not a second editable document.

### Plugins And Ports

- Core must not depend on Vue, React, Angular, Yjs, PixiJS, Figma, or a host backend.
- External capabilities implement narrow ports and register through public contribution points.
- Plugins cannot bypass transactions to write authoritative records.
- All registrations and listeners return disposables and are released on unmount.
- Load optional Figma, GPU, and collaboration capabilities lazily.
- Avoid creating an npm package for every abstraction before independent release or dependency isolation is required.

## Layout Rules

- Support `free`, `auto`, and `grid` containers.
- Free layout uses parent-local coordinates derived from workspace/world coordinates.
- Auto Layout supports direction, wrapping, gap, padding, alignment, `fixed/hug/fill`, min/max size, and explicit absolute children.
- Grid supports configurable column count, `x/y/w/h`, drag, resize, collision, nested grids, locking, and automatic compacting.
- Moving a node between layout modes must explicitly convert layout data in one transaction.
- Layout engines are deterministic pure logic wherever possible and must be golden-tested.

## Component Definitions And Instances

- A component definition owns one reusable subtree and an explicit public contract.
- An instance is a lightweight reference; it must not copy the full definition subtree.
- Instance-owned data includes external layout, public-property overrides, slot content, and event bindings.
- Stable definition-node IDs are required so overrides survive definition edits.
- Definitions may contain other instances, but direct or indirect cycles are forbidden.
- Detaching an instance materializes regular nodes in one atomic, undoable command.
- Cross-document component-library versioning is not part of the core version unless explicitly planned.

## Rendering And Performance

- Real business components render as DOM black boxes.
- Editor selection, handles, guides, and feedback render in an SVG overlay.
- GPU layers are optional adapters for massive primitives, maps, particles, and high-frequency visualization.
- ComposeUI manages business-component roots, not their internal DOM.
- Realtime data, animation frames, GPU buffers, spatial indexes, and `RenderPlan` do not belong in `PageDocument`.
- Separate editable `PageDocument` from compiled runtime `RenderPlan`.
- Use normalized records, fine-grained subscriptions, virtualized component tree, spatial indexes, viewport culling, and frame scheduling.
- Prefer DOM Islands, Worker data processing, and incremental patches before adopting a custom CanvasKit/Rust/WebGPU backend.
- Do not optimize based only on synthetic rectangles; benchmark real tables, charts, context providers, and 4K scenarios.

## Yjs Collaboration

- `@composeui/core` must not depend directly on Yjs.
- Yjs implements a collaboration port in an optional adapter.
- In collaborative mode, Y.Doc is the shared authority and the Record Store is a local query/render projection.
- Do not independently write both Y.Doc and Record Store.
- Map normalized records into shared maps; do not store the entire nested document as one JSON value.
- One ComposeUI command maps to one Yjs transaction.
- Use typed origins and Y.UndoManager to undo only current-user changes.
- Use Awareness for users, cursors, selections, and temporary presence; do not persist Awareness in `PageDocument`.
- Host owns provider transport, server authorization, update persistence, backups, and audit.
- Never put realtime business data or binary assets in Y.Doc.

## Figma Import

- Support two explicit paths: Copy as SVG and structured import through a ComposeUI Figma plugin.
- Do not depend on private Figma clipboard formats as a stable contract.
- Sanitize SVG and reject scripts, event handlers, and unsafe external resources.
- Preserve editable structure when supported; degrade unsupported effects to SVG with diagnostics.
- Component mapping uses stable Figma library/component identifiers and host component registry metadata.
- Import is one atomic, undoable command.

## Testing Rules

Use one testing stack:

- Vitest for unit, integration, and file-golden tests.
- fast-check for transaction, tree, layout, and convergence invariants.
- Playwright for browser integration, E2E, visual regression, accessibility, collaboration, and performance smoke tests.
- Do not add a second browser test runner without a demonstrated requirement.

### Golden Files

- Golden files protect migrations, patches, layouts, component resolution, RenderPlan, Figma conversion, diagnostics, and canonical Yjs convergence.
- Important goldens are readable JSON/SVG/files, not opaque large inline snapshots.
- Canonicalize IDs, time, paths, float precision, resource URLs, map keys, and diagnostic order.
- Preserve arrays where order is meaningful.
- Do not golden-test raw Yjs binary update bytes; compare canonical converged documents.
- CI never updates goldens automatically.
- Golden updates must be intentional, reviewed, and committed with the behavior change.

### E2E And Visual Tests

- Use stable roles, labels, semantic locators, and deterministic test IDs where needed.
- Do not use arbitrary sleeps; wait for explicit editor, layout, resource, render, and collaboration stability signals.
- Generate visual baselines in one fixed environment with fixed fonts, browser, viewport, DPR, locale, timezone, and disabled animations.
- PRs run Chromium core journeys; Firefox/WebKit and large performance suites may run nightly.
- Preserve Playwright trace, screenshots, canonical document, transaction log, and diagnostics on failure.

### Test Before Fix

- For a bug, add the smallest failing unit, golden, or E2E regression first.
- For schema/compiler/import changes, update or add fixtures and review golden diffs.
- For performance work, record a before/after benchmark on a fixed scenario.

## Single Playground Rule

- Use one Vite application at `apps/playground` for demos, development, E2E, visual tests, collaboration, and performance scenarios.
- Do not add Storybook or Ladle unless this decision is explicitly revisited.
- Define deterministic reusable `DemoScenario` fixtures.
- Reuse the same fixtures across Playground, Vitest goldens, Playwright, and benchmarks.
- Scenario URLs must be stable and parameter-validated.
- The Playground test API exists only in development/test builds and must use public editor APIs.

## Toolchain And Scaffold

- Use Bun for dependency installation, workspaces, the committed `bun.lock`, and repository script execution.
- Bun is a development tool, not a runtime requirement for published ComposeUI packages.
- Production packages must not import `bun:*` or depend on the `Bun` global.
- Use strict TypeScript with project references; use `tsc -b` for type checking and declarations, not browser bundling.
- Use Oxlint as the only default JavaScript/TypeScript linter and Oxfmt as the only formatter.
- Use Vite for the Playground and browser library builds, Vitest for logic/golden tests, and Playwright for browser tests.
- Do not add Turborepo, Nx, ESLint, Prettier, tsup, or another overlapping tool without a measured requirement and an explicit decision.
- Start with only `apps/playground` and the packages needed by the current vertical slice. Do not scaffold empty future packages.
- Public packages must remain consumable by ordinary npm, pnpm, Yarn, Node, and Vite hosts.
- Root scripts must expose stable `dev`, `build`, `typecheck`, `lint`, `format:check`, `test`, and `check` entry points.

## Expected Implementation Order

Unless a narrower user request overrides it, implement in vertical slices:

1. Schema and normalized Record Store.
2. Transaction, Patch, Origin, History, Command, Policy, and Diagnostic.
3. Minimal Vite Playground and test/golden infrastructure.
4. Workspace, page board, selection, component tree, and Free layout.
5. Auto Layout and Grid.
6. Framework component adapter and runtime context root.
7. Component definitions, instances, bindings, persistence, and RenderPlan compiler.
8. Figma import.
9. Yjs collaboration.
10. Advanced large-screen/GPU capabilities based on benchmarks.

Each step must produce a runnable vertical path and tests. Do not create all abstractions or empty packages before delivering a working path.

## Agent Workflow

Before editing:

1. Read this file and the relevant linked specification.
2. Inspect the repository and existing conventions.
3. Identify the smallest coherent vertical slice.
4. State assumptions and compatibility impact.
5. Add or identify tests before changing behavior.

While editing:

- Preserve public boundaries and existing user changes.
- Keep domain logic outside UI components.
- Route persistent changes through commands and transactions.
- Keep external integrations behind ports.
- Avoid unrelated refactors and speculative abstractions.
- Add diagnostics for invalid external data instead of silent fallback.

Before completion:

1. Run targeted unit/golden tests.
2. Run relevant Playground/Playwright flow for browser behavior.
3. Run typecheck and dependency-boundary checks.
4. Inspect generated golden and visual diffs.
5. Report commands run, results, untested areas, and remaining risks.

## Prohibited Shortcuts

- Directly mutate `PageDocument` or Record Store from UI code.
- Store editor session state in runtime documents.
- Create one framework root per business component.
- Mix business component frameworks in one page board.
- Render business components inside editor Shadow DOM by default.
- Treat component-internal DOM nodes as ComposeUI nodes.
- Put realtime business data, GPU buffers, or binary assets into Yjs.
- Use full-document subscriptions for local UI updates.
- Add Storybook alongside the Vite Playground.
- Use Bun-only runtime APIs in published packages.
- Add overlapping lint, format, test, build, or task-runner toolchains without an approved measured need.
- Auto-update golden files in CI.
- Use fixed sleeps to stabilize browser tests.
- Introduce complete Event Sourcing, ECS, or custom WebGPU infrastructure without an approved, measured need.

## Terminology

- Workspace: infinite editor work area; session-only viewport state.
- Page board: persisted page boundary rendered by the host application.
- Record Store: normalized authoritative local editor data store.
- Transaction: atomic validated document mutation.
- Command: user/system intent that produces a transaction.
- Projection: derived read model for UI, queries, or rendering.
- RenderPlan: compiled runtime representation of `PageDocument`.
- Component definition: reusable subtree and public contract.
- Component instance: lightweight reference with allowed overrides and slots.
- DOM Island: independently scheduled runtime DOM update boundary.
- Adapter: implementation of an external framework or service port.
- Golden file: reviewed canonical expected output for a stable contract.
