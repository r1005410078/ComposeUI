# Editor Theme Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded editor chrome styling with one framework-agnostic theme-token file and deliver the approved compact dark navy BMS appearance.

**Architecture:** `theme.css` owns default semantic custom properties, while `editor.css` and `workspace.css` retain only component structure and consume those properties. The normal editor entry bundles the default theme for compatibility, and the Vite library build additionally emits the same source file as a standalone `dist/theme.css` package export.

**Tech Stack:** TypeScript, CSS custom properties, Dockview 7, Vite library mode, Vitest, Playwright, Bun

---

## File Structure

- Create `packages/editor/src/theme.css`: default theme token declarations only.
- Create `packages/editor/test/theme-contract.test.ts`: source-level theme ownership, import-order, and package-export contract tests.
- Modify `packages/editor/src/index.ts`: load Dockview base CSS before theme and structural CSS.
- Modify `packages/editor/src/editor.css`: replace canvas and tree visual literals with semantic tokens.
- Modify `packages/editor/src/workspace/workspace.css`: replace workspace literals, style first-party panel controls, and override Dockview chrome using semantic tokens.
- Modify `packages/editor/vite.config.ts`: emit `src/theme.css` unchanged as `dist/theme.css` in addition to bundled `editor.css`.
- Modify `packages/editor/package.json`: export `@composeui/editor/theme.css`.
- Modify `apps/playground/vite.config.ts`: resolve the standalone theme entry from source during development.
- Modify `apps/playground/src/m1-free-layout-scenario.test.ts`: assert the development alias contract.
- Modify `tests/e2e/m1-editor-spine.spec.ts`: assert key themed computed styles and retain canonical layout coverage.

### Task 1: Establish the Theme Contract

**Files:**
- Create: `packages/editor/test/theme-contract.test.ts`
- Modify: `apps/playground/src/m1-free-layout-scenario.test.ts`

- [ ] **Step 1: Write the failing source contract tests**

Create `packages/editor/test/theme-contract.test.ts` with tests that read real source files rather than duplicating the CSS parser in production:

```ts
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const editorRoot = fileURLToPath(new URL("../", import.meta.url))
const readEditorFile = (path: string): string => readFileSync(`${editorRoot}${path}`, "utf8")

describe("editor theme contract", () => {
  it("defines the required semantic token groups in one theme file", () => {
    const theme = readEditorFile("src/theme.css")

    for (const token of [
      "--composeui-surface-app",
      "--composeui-surface-panel",
      "--composeui-surface-canvas",
      "--composeui-text-primary",
      "--composeui-text-muted",
      "--composeui-border-default",
      "--composeui-accent-primary",
      "--composeui-canvas-grid-minor",
      "--composeui-control-height",
      "--composeui-radius-control",
      "--composeui-font-family",
    ]) {
      expect(theme).toContain(`${token}:`)
    }
  })

  it("loads Dockview first, then theme tokens, then structural styles", () => {
    const entry = readEditorFile("src/index.ts")

    expect(entry.indexOf('"dockview/dist/styles/dockview.css"')).toBeLessThan(
      entry.indexOf('"./theme.css"'),
    )
    expect(entry.indexOf('"./theme.css"')).toBeLessThan(entry.indexOf('"./editor.css"'))
    expect(entry.indexOf('"./editor.css"')).toBeLessThan(
      entry.indexOf('"./workspace/workspace.css"'),
    )
  })

  it("exports a standalone theme stylesheet", () => {
    const packageJson = JSON.parse(readEditorFile("package.json")) as {
      exports: Record<string, string>
    }

    expect(packageJson.exports["./theme.css"]).toBe("./dist/theme.css")
  })
})
```

- [ ] **Step 2: Extend the playground alias test**

In `apps/playground/src/m1-free-layout-scenario.test.ts`, add this entry to the existing expected alias array:

```ts
expect.objectContaining({
  find: "@composeui/editor/theme.css",
  replacement: expect.stringContaining("packages/editor/src/theme.css"),
}),
```

- [ ] **Step 3: Run the tests and verify the intended failures**

Run:

```bash
bun run test packages/editor/test/theme-contract.test.ts apps/playground/src/m1-free-layout-scenario.test.ts
```

Expected: FAIL because `src/theme.css`, its package export, import order, and playground alias do not exist.

- [ ] **Step 4: Leave the verified red tests uncommitted for Task 2**

Do not commit a failing repository state. Task 2 supplies the minimal implementation and commits the tests with it after green.

### Task 2: Add the Default Theme and Public Entry

**Files:**
- Create: `packages/editor/src/theme.css`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/package.json`
- Modify: `apps/playground/vite.config.ts`

- [ ] **Step 1: Create the scoped semantic token file**

Create `packages/editor/src/theme.css`. Keep declarations grouped by role and define the same values for all independently mountable roots:

```css
.composeui-editor,
.composeui-editor__component-tree,
.composeui-editor__workspace-host {
  --composeui-surface-app: #030f1f;
  --composeui-surface-panel: #061426;
  --composeui-surface-panel-raised: #0a1b31;
  --composeui-surface-toolbar: #07172a;
  --composeui-surface-control: #0d2038;
  --composeui-surface-control-hover: #132d4d;
  --composeui-surface-canvas: #031426;
  --composeui-text-primary: #f4f8ff;
  --composeui-text-secondary: #c2ccda;
  --composeui-text-muted: #718098;
  --composeui-text-disabled: #435169;
  --composeui-text-inverse: #ffffff;
  --composeui-border-subtle: #0d233b;
  --composeui-border-default: #17324f;
  --composeui-border-strong: #244d75;
  --composeui-focus-ring: #2788ff;
  --composeui-accent-primary: #1769e8;
  --composeui-accent-hover: #267cf2;
  --composeui-accent-active: #0e58c9;
  --composeui-selection-fill: rgb(39 136 255 / 18%);
  --composeui-state-danger: #ef4f62;
  --composeui-state-warning: #f2bd4b;
  --composeui-state-success: #28b978;
  --composeui-canvas-grid-minor: rgb(40 94 145 / 24%);
  --composeui-canvas-grid-major: rgb(62 128 190 / 28%);
  --composeui-canvas-board-outline: #315675;
  --composeui-canvas-selection: #3a91ff;
  --composeui-canvas-handle-fill: #f7fbff;
  --composeui-font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  --composeui-font-size: 14px;
  --composeui-font-size-compact: 12px;
  --composeui-font-size-heading: 18px;
  --composeui-font-weight-medium: 500;
  --composeui-font-weight-semibold: 600;
  --composeui-space-1: 4px;
  --composeui-space-2: 8px;
  --composeui-space-3: 12px;
  --composeui-space-4: 16px;
  --composeui-app-bar-height: 44px;
  --composeui-tab-height: 36px;
  --composeui-toolbar-height: 42px;
  --composeui-control-height: 32px;
  --composeui-icon-button-size: 32px;
  --composeui-tree-row-height: 36px;
  --composeui-radius-control: 4px;
  --composeui-radius-panel: 3px;
  --composeui-shadow-panel: 0 8px 24px rgb(0 0 0 / 18%);
  --composeui-shadow-control: 0 1px 2px rgb(0 0 0 / 22%);
}
```

- [ ] **Step 2: Fix stylesheet load order**

Change the top of `packages/editor/src/index.ts` to:

```ts
import "dockview/dist/styles/dockview.css"
import "./theme.css"
import "./editor.css"
import "./workspace/workspace.css"
```

- [ ] **Step 3: Export the standalone theme asset**

Add this `packages/editor/package.json` export:

```json
"./theme.css": "./dist/theme.css"
```

- [ ] **Step 4: Add the development alias**

Insert this alias before the broad `@composeui/editor` alias in `apps/playground/vite.config.ts`:

```ts
{
  find: "@composeui/editor/theme.css",
  replacement: fromRoot("../../packages/editor/src/theme.css"),
},
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun run test packages/editor/test/theme-contract.test.ts apps/playground/src/m1-free-layout-scenario.test.ts
```

Expected: PASS for token presence, import order, package export, and aliases.

- [ ] **Step 6: Commit the theme API**

```bash
git add packages/editor/src/theme.css packages/editor/src/index.ts packages/editor/package.json apps/playground/vite.config.ts packages/editor/test/theme-contract.test.ts apps/playground/src/m1-free-layout-scenario.test.ts
git commit -m "feat(editor): add framework-agnostic theme tokens"
```

### Task 3: Emit the Standalone Theme During Build

**Files:**
- Modify: `packages/editor/vite.config.ts`
- Modify: `packages/editor/test/theme-contract.test.ts`

- [ ] **Step 1: Add a failing build-config contract**

Append this test to `packages/editor/test/theme-contract.test.ts`:

```ts
it("configures the build to emit the standalone theme asset", () => {
  const config = readEditorFile("vite.config.ts")

  expect(config).toContain('fileName: "theme.css"')
  expect(config).toContain('new URL("./src/theme.css", import.meta.url)')
})
```

- [ ] **Step 2: Run the focused test and verify red**

```bash
bun run test packages/editor/test/theme-contract.test.ts
```

Expected: FAIL because Vite only emits the combined `editor.css`.

- [ ] **Step 3: Add a focused Vite asset-emission plugin**

Update `packages/editor/vite.config.ts` to read the source theme once at build time and emit it unchanged:

```ts
import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"

function emitThemeCss(): Plugin {
  return {
    name: "composeui-emit-theme-css",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "theme.css",
        source: readFileSync(new URL("./src/theme.css", import.meta.url), "utf8"),
      })
    },
  }
}

export default defineConfig({
  plugins: [emitThemeCss()],
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index", cssFileName: "editor" },
  },
})
```

- [ ] **Step 4: Verify the focused test and actual build output**

```bash
bun run test packages/editor/test/theme-contract.test.ts
bun run --cwd packages/editor build
test -f packages/editor/dist/editor.css
test -f packages/editor/dist/theme.css
cmp packages/editor/src/theme.css packages/editor/dist/theme.css
```

Expected: test PASS; both CSS assets exist; `cmp` exits 0.

- [ ] **Step 5: Commit build publication support**

```bash
git add packages/editor/vite.config.ts packages/editor/test/theme-contract.test.ts
git commit -m "build(editor): emit standalone theme stylesheet"
```

### Task 4: Migrate Canvas and Tree Styling to Tokens

**Files:**
- Modify: `packages/editor/test/theme-contract.test.ts`
- Modify: `packages/editor/src/editor.css`

- [ ] **Step 1: Add a failing hard-coded palette guard**

Add this test to `packages/editor/test/theme-contract.test.ts`:

```ts
it("keeps the editor structural stylesheet free of palette literals", () => {
  const structuralCss = readEditorFile("src/editor.css")
  const paletteLiterals = structuralCss.match(/#[0-9a-f]{3,8}|rgb\([^)]*\)/gi) ?? []

  expect(paletteLiterals).toEqual([])
})
```

- [ ] **Step 2: Run the test and verify red**

```bash
bun run test packages/editor/test/theme-contract.test.ts
```

Expected: FAIL and report the existing light-theme colors and grid RGB values.

- [ ] **Step 3: Replace visual literals in `editor.css`**

Remove the old custom-property declarations from `editor.css` and map structure to the new semantic tokens. Use these exact substitutions:

```css
color: var(--composeui-text-primary);
font-family: var(--composeui-font-family);
font-size: var(--composeui-font-size);
background: var(--composeui-surface-panel);
border-color: var(--composeui-border-default);
height: var(--composeui-tree-row-height);
background: var(--composeui-selection-fill);
color: var(--composeui-text-muted);
background: var(--composeui-surface-canvas);
stroke: var(--composeui-canvas-selection);
fill: var(--composeui-canvas-handle-fill);
```

Define the grid without color literals:

```css
background-image:
  linear-gradient(to right, var(--composeui-canvas-grid-minor) 1px, transparent 1px),
  linear-gradient(to bottom, var(--composeui-canvas-grid-minor) 1px, transparent 1px);
```

Map the page board outline, shadow, and marquee fill to `--composeui-canvas-board-outline`, `--composeui-shadow-panel`, and `--composeui-selection-fill`.

- [ ] **Step 4: Run focused editor tests**

```bash
bun run test packages/editor/test/theme-contract.test.ts packages/editor/test/editor-composition.test.ts packages/editor/test/editor-view.test.ts
```

Expected: PASS with no structural CSS palette literals and no editor behavior regression.

- [ ] **Step 5: Commit the canvas and tree migration**

```bash
git add packages/editor/src/editor.css packages/editor/test/theme-contract.test.ts
git commit -m "refactor(editor): theme canvas and component tree"
```

### Task 5: Theme Workspace, Panels, Controls, and Dockview

**Files:**
- Modify: `packages/editor/test/theme-contract.test.ts`
- Modify: `packages/editor/src/workspace/workspace.css`

- [ ] **Step 1: Extend the palette guard to workspace structure**

Replace the previous guard body with:

```ts
it("keeps structural stylesheets free of palette literals", () => {
  for (const path of ["src/editor.css", "src/workspace/workspace.css"]) {
    const structuralCss = readEditorFile(path)
    const paletteLiterals = structuralCss.match(/#[0-9a-f]{3,8}|rgb\([^)]*\)/gi) ?? []
    expect(paletteLiterals, path).toEqual([])
  }
})
```

- [ ] **Step 2: Run the test and verify red**

```bash
bun run test packages/editor/test/theme-contract.test.ts
```

Expected: FAIL on the hard-coded workspace palette.

- [ ] **Step 3: Convert workspace chrome to theme tokens**

In `workspace.css`, remove local color variables and use the semantic tokens for shell, app bar, project title, toolbar, button states, canvas panel, borders, typography, dimensions, and shadows. Keep grid/flex/overflow/media-query rules in this file.

Primary app actions use:

```css
.composeui-editor__app-action {
  background: var(--composeui-accent-primary);
  border: 1px solid var(--composeui-accent-hover);
  border-radius: var(--composeui-radius-control);
  box-shadow: var(--composeui-shadow-control);
  color: var(--composeui-text-inverse);
  height: var(--composeui-control-height);
  width: var(--composeui-icon-button-size);
}

.composeui-editor__app-action:hover {
  background: var(--composeui-accent-hover);
}
```

Utility toolbar buttons use `--composeui-surface-control`, `--composeui-surface-control-hover`, and the icon-button dimension tokens.

- [ ] **Step 4: Add first-party panel and form-control styling**

Style `.composeui-editor__empty-panel`, `.composeui-editor__inspector`, `.composeui-editor__history`, and `.composeui-editor__resources` with shared panel padding, heading typography, muted empty-state text, themed inputs, and compact buttons. Include explicit `:focus-visible` outlines using `--composeui-focus-ring` and disabled states using `--composeui-text-disabled`.

- [ ] **Step 5: Add scoped Dockview overrides**

Under `.composeui-editor__workspace-host`, map Dockview's theme variables and chrome to ComposeUI tokens. Cover these visible surfaces:

```css
.composeui-editor__workspace-host .dockview-theme-abyss,
.composeui-editor__workspace-host .dv-dockview {
  --dv-background-color: var(--composeui-surface-app);
  --dv-paneview-header-border-color: var(--composeui-border-default);
  --dv-tabs-and-actions-container-background-color: var(--composeui-surface-panel);
  --dv-activegroup-visiblepanel-tab-background-color: var(--composeui-surface-panel-raised);
  --dv-activegroup-visiblepanel-tab-color: var(--composeui-text-primary);
  --dv-inactivegroup-visiblepanel-tab-color: var(--composeui-text-secondary);
  --dv-separator-border: var(--composeui-border-default);
}
```

Add the active-tab indicator, compact tab height, close-button hover, and sash hover with these Dockview 7 selectors:

```css
.composeui-editor__workspace-host .dv-tabs-and-actions-container {
  min-height: var(--composeui-tab-height);
}

.composeui-editor__workspace-host .dv-tab.dv-active-tab::after {
  background: var(--composeui-accent-primary);
}

.composeui-editor__workspace-host .dv-tab .dv-default-tab .dv-default-tab-action:hover {
  background: var(--composeui-surface-control-hover);
}

.composeui-editor__workspace-host
  .dv-split-view-container
  .dv-sash-container
  .dv-sash:not(.dv-disabled):hover {
  background: var(--composeui-accent-primary);
}
```

Do not change panel sizing, drag/drop, or persistence behavior.

- [ ] **Step 6: Run focused workspace tests**

```bash
bun run test packages/editor/test/theme-contract.test.ts packages/editor/test/editor-workspace.test.ts packages/editor/test/workspace-panels.test.ts packages/editor/test/workspace-toolbar.test.ts
```

Expected: PASS with no workspace palette literals or behavior regressions.

- [ ] **Step 7: Commit the workspace theme**

```bash
git add packages/editor/src/workspace/workspace.css packages/editor/test/theme-contract.test.ts
git commit -m "feat(editor): apply dark navy workspace theme"
```

### Task 6: Add Browser-Level Theme Regression Coverage

**Files:**
- Modify: `tests/e2e/m1-editor-spine.spec.ts`

- [ ] **Step 1: Add a failing computed-style assertion**

In the canonical Godot workspace E2E test, inspect the shell, active canvas tab, canvas workspace, and run action:

```ts
const themeState = await page.evaluate(() => {
  const style = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!)
  return {
    shellBackground: style(".composeui-editor__workspace-shell").backgroundColor,
    canvasBackground: style(".composeui-editor__workspace").backgroundColor,
    runBackground: style("[data-testid='workspace-run']").backgroundColor,
    primaryToken: style(".composeui-editor__workspace-host").getPropertyValue(
      "--composeui-accent-primary",
    ),
  }
})

expect(themeState).toEqual({
  shellBackground: "rgb(3, 15, 31)",
  canvasBackground: "rgb(3, 20, 38)",
  runBackground: "rgb(23, 105, 232)",
  primaryToken: "#1769e8",
})
```

- [ ] **Step 2: Prove the computed-style assertion detects a theme regression**

```bash
bun run test:e2e --grep "mounts the Godot 2D workspace"
```

Temporarily set `shellBackground` to `"rgb(255, 255, 255)"`, run the command, and confirm it fails only on that assertion. Restore `"rgb(3, 15, 31)"`, rerun, and expect PASS. Do not commit the temporary expectation.

- [ ] **Step 3: Verify desktop and narrow layout invariants**

Keep the existing canonical panel assertions and add checks that the canvas board and toolbar remain visible, horizontal overflow is contained inside the canvas scroller, and run/save buttons do not overlap the title at the narrow project viewport.

- [ ] **Step 4: Run the targeted E2E coverage**

```bash
bun run test:e2e --grep "Godot 2D workspace|narrow"
```

Expected: PASS.

- [ ] **Step 5: Commit browser regression coverage**

```bash
git add tests/e2e/m1-editor-spine.spec.ts
git commit -m "test(editor): cover dark workspace theme"
```

### Task 7: Full Verification and Visual QA

**Files:**
- Modify only files required to resolve verification findings.

- [ ] **Step 1: Format changed source and test files**

```bash
bun run format
```

Expected: formatter exits 0. Review `git diff` afterward and preserve unrelated user edits.

- [ ] **Step 2: Run the complete repository check**

```bash
bun run check
```

Expected: formatting, lint, typecheck, all Vitest tests, and all workspace builds PASS.

- [ ] **Step 3: Run the complete browser suite**

```bash
bun run test:e2e
```

Expected: all Playwright tests PASS. If the sandbox blocks the preview server with `EPERM`, rerun the same command with approved escalation.

- [ ] **Step 4: Perform visual QA at desktop and narrow widths**

Start the playground:

```bash
bun run dev -- --host 127.0.0.1
```

Use Playwright/browser screenshots at `1440x900` and `640x900`. Confirm:

- BMS title and run/save actions are readable and do not overlap.
- scene tree rows fit their panel and retain visible action icons.
- canvas toolbar stays inside the canvas panel.
- canvas nodes and selection handles remain visible against the dark grid.
- inspector, history, resources, output, and Dockview active tabs share one visual system.
- no blank panels, accidental white surfaces, clipped text, or incoherent nested borders appear.

- [ ] **Step 5: Verify package assets and final diff**

```bash
test -f packages/editor/dist/editor.css
test -f packages/editor/dist/theme.css
cmp packages/editor/src/theme.css packages/editor/dist/theme.css
git diff --check
git status --short
```

Expected: both assets exist, standalone theme matches its source, diff check exits 0, and status contains only intentional changes plus the user's pre-existing edits.

- [ ] **Step 6: Commit only verification fixes when Step 4 changed source**

Review `git diff --name-only`, stage each intentional file by its exact path, and commit with:

```bash
git commit -m "fix(editor): polish themed workspace layout"
```

Skip this step when verification required no code changes. Never stage the user's pre-existing playground title and matching assertion edits unless they were already intentionally included by the user in this feature.
