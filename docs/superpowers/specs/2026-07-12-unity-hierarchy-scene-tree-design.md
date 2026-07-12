# Unity Hierarchy Scene Tree Design

## Goal

Refine the ComposeUI scene tree, history panel, and output panel into compact Unity-inspired editor surfaces while preserving existing editor behavior.

## Scope

This change affects scene tree icon rendering and the presentation of the history and output panels. It does not change the document schema, editor command semantics, Dockview layout, selection model, or public tree API.

## Visual Structure

Each tree row uses a compact height of approximately 28 pixels. Indentation, icon size, row height, action opacity, hover color, selected color, and drag indicator color are theme tokens in `theme.css`.

The row is divided into three regions:

- disclosure control: a thin right/down chevron for collapsed and expanded nodes
- identity: a type icon followed by an ellipsized node name
- actions: visibility, lock, move up, and move down icon buttons

Pages use a page/scene icon. Rectangle nodes use a square object icon. Lucide icons are used consistently rather than text glyphs or custom SVG markup.

## Interaction States

Actions remain in the row layout so names do not resize when actions become prominent.

Action icons are muted by default. They become clear when the row is hovered, keyboard focus is inside the row, or the row is selected. Active semantic states remain clear at all times:

- hidden nodes show the visibility-off state
- locked nodes show the locked state
- disabled reorder actions remain visibly disabled

Hover applies a restrained full-row background. Selection applies a stronger blue-gray full-row background and a narrow accent line on the leading edge. Keyboard focus uses the existing theme focus ring without changing row geometry.

During drag, the source row is muted. A valid target row displays an insertion indicator. Invalid targets keep the existing no-drop behavior and do not display the indicator.

## Behavior Preservation

The implementation preserves:

- stable existing test IDs
- tree and treeitem ARIA roles
- arrow, Home, End, Enter, Space, Delete, and Backspace behavior
- click and modifier multi-selection
- double-click inline rename
- visibility and lock commands
- sibling move up/down commands
- same-parent drag reorder validation
- focus and scroll restoration after rebuilds

Buttons retain accessible names and tooltips. Icon-only controls do not expose raw glyph text.

## History Panel

The Dockview tab already identifies the panel, so the duplicate in-panel `历史` heading is removed.

The panel uses two compact regions:

- toolbar: icon-only undo and redo commands with tooltips, accessible names, disabled states, and stable existing test IDs
- history list: dense rows with muted sequence numbers and the command label as primary text

The newest history entry receives a restrained highlight. Long command labels truncate with an accessible full label. The list owns vertical scrolling and does not resize the toolbar. Existing undo/redo behavior and future-entry presentation remain intact.

## Output Panel

The duplicate in-panel `输出` heading is removed. The panel follows a Unity Console-style content structure:

- independently scrolling message region
- centered muted empty state when no messages exist

Phase one renders the message region and current empty state only. It does not render placeholder controls or introduce a new logging service or command API. A compact clear/filter/log-level toolbar can be added when those commands exist. Future normal, warning, and error messages will use themed status icons and existing semantic state colors.

## Architecture

`component-tree.ts` owns semantic DOM and icon state. It creates Lucide icon elements for disclosure, record type, and actions, and exposes state through existing ARIA/data attributes.

`workspace/panels.ts` owns history and output panel structure. It continues using the existing editor and history APIs and does not add cross-panel state.

`editor.css` owns scene tree layout and interaction styling. `workspace/workspace.css` owns history and output panel layout. Both consume only semantic theme variables for colors, dimensions, opacity, and spacing.

`theme.css` owns the default Unity-inspired token values. Consumers can change tree density and emphasis without changing component code.

No framework-specific adapter is introduced; the tree remains plain DOM and works through the same editor package from React, Vue 2, Vue 3, Angular, or direct DOM hosts.

## Testing

Unit tests verify:

- disclosure and record-type icons render
- action buttons retain test IDs and accessible labels
- visibility and lock states select the correct icons and state attributes
- existing keyboard, rename, selection, and reorder behavior remains unchanged
- structural CSS consumes the new tree theme tokens
- history and output do not render duplicate inner headings
- history toolbar commands retain accessible labels, disabled states, and existing test IDs
- history rows and output empty state use the intended semantic structure

Playwright verifies the scene tree and bottom/left panels remain visible, compact, non-overlapping, and contained at desktop and narrow viewports. Existing end-to-end tree, history, and layout operations continue to pass.

## Non-Goals

- adding hierarchy search or filtering
- changing tree data or command semantics
- introducing context menus
- adding drag reparenting
- hiding actions completely until hover
- introducing a logging backend
- adding working output filters before messages exist
- reproducing Unity branding or proprietary assets
