# Unity-Inspired Editor Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the scene hierarchy, history panel, and output panel as compact Unity-inspired editor surfaces without changing their editor behavior.

**Architecture:** `component-tree.ts` renders semantic Lucide icons and state attributes while preserving all current commands and IDs. `workspace/panels.ts` renders compact history/output structures; `theme.css`, `editor.css`, and `workspace.css` own density and visual states through semantic tokens.

**Tech Stack:** TypeScript, DOM APIs, Lucide, CSS custom properties, Vitest/jsdom, Playwright, Dockview

---

## File Structure

- Modify `packages/editor/src/component-tree.ts`: replace glyph controls with Lucide icons and expose row/action state.
- Modify `packages/editor/src/theme.css`: add hierarchy and compact-panel tokens.
- Modify `packages/editor/src/editor.css`: implement compact hierarchy layout, weak actions, selection, focus, and drag states.
- Modify `packages/editor/src/workspace/panels.ts`: render icon history controls, dense entries, and a dedicated output empty state without duplicate headings.
- Modify `packages/editor/src/workspace/workspace.css`: style history/output as compact editor panels.
- Modify `packages/editor/test/editor-view.test.ts`: verify hierarchy icon/state structure and preserve existing behavior.
- Modify `packages/editor/test/workspace-panels.test.ts`: verify history/output semantic structure and commands.
- Modify `packages/editor/test/theme-contract.test.ts`: verify all new tokens are declared and consumed.
- Modify `tests/e2e/m1-editor-spine.spec.ts`: verify compact hierarchy and panel containment while preserving existing interaction coverage.

### Task 1: Render Semantic Hierarchy Icons

**Files:**
- Modify: `packages/editor/test/editor-view.test.ts`
- Modify: `packages/editor/src/component-tree.ts`

- [ ] **Step 1: Add failing icon and state tests**

Add a test beside the existing tree command tests in `packages/editor/test/editor-view.test.ts`:

```ts
it("renders semantic hierarchy icons and active visibility and lock states", () => {
  const root = document.createElement("div")
  const editor = createEditor(createDocumentWithPage())
  addRectangle(editor, { id: "node-a", name: "Node A", locked: true })
  addRectangle(editor, { id: "node-b", name: "Node B" })
  editor.dispatch({ id: "node.setVisible", payload: { id: "node-b", visible: false } })
  mountEditor(root, editor, { pageId: "page-1" })

  expect(root.querySelector("[data-testid='tree-icon-page-1'] svg")).not.toBeNull()
  expect(root.querySelector("[data-testid='tree-icon-node-a'] svg")).not.toBeNull()
  expect(root.querySelector("[data-testid='tree-toggle-page-1'] svg")).not.toBeNull()
  expect(root.querySelector("[data-testid='tree-lock-node-a']")?.getAttribute("aria-pressed")).toBe(
    "true",
  )
  expect(
    root.querySelector("[data-testid='tree-visibility-node-b']")?.getAttribute("aria-pressed"),
  ).toBe("false")
  for (const action of ["visibility", "lock", "move-up", "move-down"]) {
    expect(root.querySelector(`[data-testid='tree-${action}-node-a'] svg`)).not.toBeNull()
  }
})
```

Add an assertion to the existing expand keyboard test that the disclosure button contains an SVG before and after expansion.

- [ ] **Step 2: Run the test and verify red**

```bash
bun run test packages/editor/test/editor-view.test.ts
```

Expected: FAIL because tree controls still contain `+`, `-`, `V`, `L`, `^`, and `v` text and do not expose pressed state.

- [ ] **Step 3: Introduce a Lucide icon helper**

In `component-tree.ts`, import the required icons and helper:

```ts
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  File,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  createElement as createIconElement,
} from "lucide"
```

Add a focused icon helper:

```ts
type TreeIcon = Parameters<typeof createIconElement>[0]

function icon(iconNode: TreeIcon): SVGElement {
  const element = createIconElement(iconNode)
  element.setAttribute("aria-hidden", "true")
  element.setAttribute("focusable", "false")
  return element
}
```

- [ ] **Step 4: Replace disclosure glyphs**

In `createExpandControl`, replace `button.textContent` with:

```ts
button.replaceChildren(icon(isExpanded ? ChevronDown : ChevronRight))
```

Keep its current test ID, `aria-expanded`, click, and keyboard listeners unchanged.

- [ ] **Step 5: Add record identity icons**

Before the select button, create:

```ts
const typeIcon = document.createElement("span")
typeIcon.className = "composeui-editor__tree-type-icon"
typeIcon.dataset.testid = `tree-icon-${item.id}`
typeIcon.setAttribute("aria-hidden", "true")
typeIcon.append(icon(item.typeName === "page" ? File : Box))
row.append(typeIcon)
```

Keep the type icon outside the select button so the existing select button text remains exactly the node name for tests and assistive technology.

- [ ] **Step 6: Replace action glyphs and expose state**

Change `createActionButton` to accept a `TreeIcon` and optional pressed value:

```ts
function createActionButton(
  item: TreeItem,
  action: string,
  label: string,
  iconNode: TreeIcon,
  disabled: boolean,
  execute: () => void,
  pressed?: boolean,
): HTMLButtonElement {
  // retain the existing type, class, test ID, title, label, and click behavior
  if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed))
  button.replaceChildren(icon(iconNode))
  return button
}
```

Use these mappings:

```ts
item.visible ? Eye : EyeOff
item.locked ? Lock : Unlock
ArrowUp
ArrowDown
```

Set visibility pressed to `item.visible` and lock pressed to `item.locked`. Preserve all command payloads and disabled reorder conditions.

- [ ] **Step 7: Run editor tests and verify green**

```bash
bun run test packages/editor/test/editor-view.test.ts packages/editor/test/editor-composition.test.ts
```

Expected: PASS, including existing selection, rename, command, keyboard, and reorder tests.

- [ ] **Step 8: Commit hierarchy semantics**

```bash
git add packages/editor/src/component-tree.ts packages/editor/test/editor-view.test.ts
git commit -m "feat(editor): add semantic hierarchy icons"
```

### Task 2: Apply Compact Unity Hierarchy Styling

**Files:**
- Modify: `packages/editor/test/theme-contract.test.ts`
- Modify: `packages/editor/src/theme.css`
- Modify: `packages/editor/src/editor.css`

- [ ] **Step 1: Add a failing hierarchy token contract**

Add to `theme-contract.test.ts`:

```ts
it("defines and consumes compact hierarchy tokens", () => {
  const theme = readEditorFile("src/theme.css")
  const editorCss = readEditorFile("src/editor.css")
  for (const token of [
    "--composeui-tree-row-height",
    "--composeui-tree-indent",
    "--composeui-tree-icon-size",
    "--composeui-tree-action-opacity",
    "--composeui-tree-row-hover",
    "--composeui-tree-row-selected",
    "--composeui-tree-drag-indicator",
  ]) {
    expect(theme, token).toContain(`${token}:`)
    expect(editorCss, token).toContain(`var(${token})`)
  }
})
```

- [ ] **Step 2: Run the contract and verify red**

```bash
bun run test packages/editor/test/theme-contract.test.ts
```

Expected: FAIL on the newly required hierarchy tokens.

- [ ] **Step 3: Add default hierarchy tokens**

Add to the theme dimensions and states:

```css
--composeui-tree-row-height: 28px;
--composeui-tree-indent: 16px;
--composeui-tree-icon-size: 14px;
--composeui-tree-action-opacity: 0.34;
--composeui-tree-action-opacity-active: 0.9;
--composeui-tree-row-hover: var(--composeui-surface-control);
--composeui-tree-row-selected: var(--composeui-selection-fill);
--composeui-tree-drag-indicator: var(--composeui-accent-primary);
```

- [ ] **Step 4: Consume the indent token from component code**

Because depth is dynamic, change the row indentation assignment in `component-tree.ts` to:

```ts
row.style.setProperty("--composeui-tree-depth", String(item.depth))
```

In `editor.css`, compute padding with tokens:

```css
padding-inline-start: calc(
  var(--composeui-space-2) + var(--composeui-tree-depth, 0) * var(--composeui-tree-indent)
);
```

- [ ] **Step 5: Implement row identity and action layout**

Style disclosure, type, and action icons at `--composeui-tree-icon-size`. Keep all action columns in layout. Apply default action opacity and raise it for `:hover`, `:focus-within`, and selected rows.

Use full-row hover and selected backgrounds. Add a leading selected accent with a pseudo-element positioned inside the row. Ensure `.composeui-editor__tree-select` keeps `min-width: 0`, ellipsis, and no font-size viewport scaling.

- [ ] **Step 6: Implement semantic state emphasis**

Use `[aria-pressed="true"]` for active visibility/lock emphasis. Hidden node names remain muted. Disabled reorder buttons retain low contrast and cannot appear active.

- [ ] **Step 7: Implement drag states**

Add CSS for:

```css
.composeui-editor__tree-row[data-dragging="true"] {
  opacity: var(--composeui-tree-action-opacity);
}

.composeui-editor__tree-row[data-drop-target="true"]::after {
  background: var(--composeui-tree-drag-indicator);
  bottom: 0;
  content: "";
  height: 2px;
  inset-inline: var(--composeui-space-2);
  position: absolute;
}
```

In the valid `dragover` branch, set `row.dataset.dropTarget = "true"`; remove it on `dragleave`, `drop`, and `dragend`. Do not set it for invalid targets.

- [ ] **Step 8: Run focused tests**

```bash
bun run test packages/editor/test/theme-contract.test.ts packages/editor/test/editor-view.test.ts
```

Expected: PASS with compact hierarchy tokens and all existing behavior intact.

- [ ] **Step 9: Commit hierarchy styling**

```bash
git add packages/editor/src/component-tree.ts packages/editor/src/theme.css packages/editor/src/editor.css packages/editor/test/theme-contract.test.ts
git commit -m "feat(editor): style Unity-inspired hierarchy"
```

### Task 3: Refine History and Output Panels

**Files:**
- Modify: `packages/editor/test/workspace-panels.test.ts`
- Modify: `packages/editor/src/workspace/panels.ts`
- Modify: `packages/editor/src/theme.css`
- Modify: `packages/editor/src/workspace/workspace.css`

- [ ] **Step 1: Add failing panel structure tests**

Extend the history test with:

```ts
expect(root.querySelector(".composeui-editor__history > h2")).toBeNull()
expect(root.querySelector("[data-testid='history-toolbar']")).not.toBeNull()
expect(root.querySelector("[data-testid='history-undo'] svg")).not.toBeNull()
expect(root.querySelector("[data-testid='history-redo'] svg")).not.toBeNull()
expect(root.querySelector("[data-testid='history-entry']")?.getAttribute("title")).toBe(
  "node.create",
)
expect(root.querySelector("[data-testid='history-entry']")?.getAttribute("data-current")).toBe(
  "true",
)
```

Replace the output utility assertion with:

```ts
const outputRoot = document.createElement("div")
panel("output").mount(outputRoot, context)
expect(outputRoot.querySelector(".composeui-editor__output > h2")).toBeNull()
expect(outputRoot.querySelector("[data-testid='output-messages']")).not.toBeNull()
expect(outputRoot.querySelector("[data-testid='empty-output']")?.textContent).toBe("暂无输出。")
```

- [ ] **Step 2: Run the panel test and verify red**

```bash
bun run test packages/editor/test/workspace-panels.test.ts
```

Expected: FAIL because history uses text buttons and duplicate heading, and output uses generic `emptyPanel` markup.

- [ ] **Step 3: Add a shared icon button helper to panels**

Import `Undo2`, `Redo2`, and `createElement as createIconElement` from Lucide. Add:

```ts
function panelIconButton(
  testId: string,
  label: string,
  iconNode: Parameters<typeof createIconElement>[0],
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.dataset.testid = testId
  button.title = label
  button.setAttribute("aria-label", label)
  const svg = createIconElement(iconNode)
  svg.setAttribute("aria-hidden", "true")
  button.append(svg)
  return button
}
```

- [ ] **Step 4: Rebuild history without duplicate heading**

Use a toolbar with `data-testid="history-toolbar"`, create undo/redo through the helper, and retain current click handlers and disabled logic.

For each history entry:

```ts
item.dataset.testid = "history-entry"
item.dataset.current = String(index === 0)
item.title = entry.label
const sequence = document.createElement("span")
sequence.className = "composeui-editor__history-sequence"
sequence.textContent = String(entries.length - index)
const label = document.createElement("span")
label.className = "composeui-editor__history-label"
label.textContent = entry.label
item.append(sequence, label)
```

Keep the future entry semantics and set a full `title` on it. Replace panel children with toolbar and list only.

- [ ] **Step 5: Add a dedicated output panel**

Add `createOutputPanel()` that mounts:

```ts
const panel = document.createElement("section")
panel.className = "composeui-editor__output"
panel.setAttribute("aria-label", "输出")
const messages = document.createElement("div")
messages.className = "composeui-editor__output-messages"
messages.dataset.testid = "output-messages"
const empty = document.createElement("p")
empty.dataset.testid = "empty-output"
empty.textContent = "暂无输出。"
messages.append(empty)
panel.append(messages)
```

Return an idempotent disposer. Replace `createUtilityPanel("output")` with `createOutputPanel()` in the first-party panel list. Do not modify panel metadata or closability.

- [ ] **Step 6: Add compact panel tokens and CSS**

Add theme tokens:

```css
--composeui-panel-toolbar-height: 32px;
--composeui-panel-row-height: 26px;
--composeui-panel-empty-max-width: 240px;
```

Style history as a two-row grid (`toolbar` + scrolling list). Remove inherited full-panel padding from history/output, style icon buttons with the existing control/icon tokens, and render history rows as sequence/label columns with ellipsis. Highlight `[data-current="true"]` using the selected surface token.

Style output messages as a scrollable grid and center `empty-output` with muted text. Do not render fake toolbar controls.

- [ ] **Step 7: Run panel and theme tests**

```bash
bun run test packages/editor/test/workspace-panels.test.ts packages/editor/test/theme-contract.test.ts
```

Expected: PASS with no duplicate inner history/output headings and all commands preserved.

- [ ] **Step 8: Commit panel refinement**

```bash
git add packages/editor/src/workspace/panels.ts packages/editor/src/theme.css packages/editor/src/workspace/workspace.css packages/editor/test/workspace-panels.test.ts packages/editor/test/theme-contract.test.ts
git commit -m "feat(editor): refine history and output panels"
```

### Task 4: Browser Regression and Full Verification

**Files:**
- Modify: `tests/e2e/m1-editor-spine.spec.ts`

- [ ] **Step 1: Add a failing compact panel browser assertion**

In the canonical workspace test, add:

```ts
const pageRow = page.getByTestId("tree-row-page-1")
const redRow = page.getByTestId("tree-row-node-red")
await expect(pageRow.locator("svg")).toHaveCount(2)
await expect(redRow.locator("svg")).toHaveCount(5)
const pageBox = await pageRow.boundingBox()
const redBox = await redRow.boundingBox()
expect(pageBox?.height).toBeLessThanOrEqual(30)
expect(redBox?.height).toBeLessThanOrEqual(30)

await page.getByRole("tab", { name: "历史" }).click()
await expect(page.getByTestId("history-toolbar")).toBeVisible()
await expect(page.locator(".composeui-editor__history > h2")).toHaveCount(0)

await expect(page.locator(".composeui-editor__output > h2")).toHaveCount(0)
await expect(page.getByTestId("empty-output")).toBeVisible()
```

- [ ] **Step 2: Run the canonical test and verify red before implementation, or prove the assertion**

```bash
bun run test:e2e --grep "mounts the Godot 2D workspace"
```

Expected before Tasks 1-3: FAIL on missing icons/toolbar/output structure. If Tasks 1-3 are already present, temporarily require an impossible SVG count, verify failure, restore the correct count, and rerun.

- [ ] **Step 3: Run focused browser coverage**

```bash
bun run test:e2e --grep "mounts the Godot 2D workspace|creates a node and performs tree rename|viewport without overlap"
```

Expected: all matching tests PASS.

- [ ] **Step 4: Run source verification**

```bash
bun run lint
bun run typecheck
bun run build
bun run test packages/editor/test/editor-view.test.ts packages/editor/test/editor-composition.test.ts packages/editor/test/workspace-panels.test.ts packages/editor/test/theme-contract.test.ts
```

Expected: lint, typecheck, build, and focused Vitest tests PASS. If typecheck is blocked by the existing generated `@composeui/core` declaration issue, record the exact output and do not modify unrelated package publication.

- [ ] **Step 5: Run full browser verification**

```bash
bun run test:e2e
```

Expected: all Playwright tests PASS. Use approved escalation if the local preview server cannot bind port 4173 in the sandbox.

- [ ] **Step 6: Verify theme artifacts and worktree scope**

```bash
test -f packages/editor/dist/theme.css
cmp packages/editor/src/theme.css packages/editor/dist/theme.css
git diff --check
git status --short
```

Expected: theme source and artifact match; no whitespace errors; user edits in `apps/playground/src/main.ts`, `packages/editor/src/workspace/panels.ts`, `packages/editor/test/editor-workspace.test.ts`, and `tests/e2e/m1-editor-spine.spec.ts` remain preserved unless an overlapping file was intentionally updated with those edits retained.

- [ ] **Step 7: Commit E2E coverage**

```bash
git add tests/e2e/m1-editor-spine.spec.ts
git commit -m "test(editor): cover Unity-inspired panels"
```
