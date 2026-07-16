# ComposeUI

Embeddable visual page composition for existing web apps. Host applications mount an editor, save a JSON `PageDocument`, and render that document at runtime.

## Status

M0/M1 spine is implemented: transactional document core, Free Layout desktop editor, Dockview workspace, and optional operation log / replay. Most product design (Auto/Grid, framework adapters, Yjs, Figma, RenderPlan, GPU) is **not** implemented yet.

**What the code does today:** [docs/current-architecture.md](docs/current-architecture.md)

**Product and target design:** [docs/project-overview.md](docs/project-overview.md)

## Packages

| Package | Role | Source layout |
| --- | --- | --- |
| `@composeui/core` | Authoritative document store, transactions, commands, history | `document/` · `store/` · `kernel/` · `query/` · `shared/` |
| `@composeui/editor` | Session state, canvas/tree UI, workspace shell | `session/` · `canvas/` · `tree/` · `workspace/` · `operation-log/` · `styles/` |
| `@composeui/operation-log` | Side-channel record / persist / replay | `adapters/` · `replay/` · recorder/store/… |
| `apps/playground` | Single Vite demo and E2E host | — |

Folder maps: [packages/core/src/README.md](packages/core/src/README.md), [packages/editor/src/README.md](packages/editor/src/README.md).

## Develop

```bash
bun install
bun run dev          # playground
bun run check        # format, lint, typecheck, test, build
```

Agent and contribution rules: [AGENTS.md](AGENTS.md).
